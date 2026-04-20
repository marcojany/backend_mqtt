// index.js
import express from "express";
import cors from "cors";
import mqtt from "mqtt";
import { DateTime } from 'luxon';
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
//import dotenv from "dotenv"; //per uso locale utilizza il file .env
import bodyParser from "body-parser";
//dotenv.config();

// --- Configurazione Express ---
const app = express();
app.use(bodyParser.json());
app.use(cors({origin: true, credentials: true}));  //! Abilita CORS per tutte le origini, modifica per limitare al dominio del frontend
//app.use(cors({
//origin: process.env.FRONTEND_URL || true,  // URL del frontend (usa variabile d'ambiente in produzione)
//credentials: true  // Necessario per inviare header Authorization
//}));

// --- Configurazione JWT ---
const JWT_SECRET = process.env.JWT_SECRET || 'd53d4652b4e0a9a0081eaf5311ce5c280a02726927b74b6ea2b3b37e67630879';
const JWT_EXPIRES_IN = '24h';  // Token valido per 24 ore

// --- Credenziali Admin (in produzione usa variabili d'ambiente) ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
// Password di default: "admin123" (hash bcrypt)
// Cambia la password usando: bcrypt.hashSync('tua_password', 10)
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '$2b$10$u5prcWI4xm0CbKb8jYX3wuhZPOLj55wJcYVXNiE3duYIkpHTo2Zlu';

// --- Middleware di autenticazione JWT ---
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Non autenticato - Token mancante' });
  }

  const token = authHeader.substring(7); // Rimuove "Bearer "

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Salva i dati utente nella request
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Non autenticato - Token non valido' });
  }
};

// --- Connessione MQTT ---
const client = mqtt.connect({
  host: process.env.MQTT_HOST,
  port: parseInt(process.env.MQTT_PORT),
  protocol: "mqtts",
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  rejectUnauthorized: false
});

client.on("connect", () => {
  console.log("✅ Connesso a HiveMQ Cloud via MQTT");
  
  // Subscribe al topic di status della luce
  client.subscribe(process.env.MQTT_TOPIC_LUCE_STATUS, (err) => {
    if (err) {
      console.error("❌ Errore subscribe MQTT_TOPIC_LUCE_STATUS:", err);
    } else {
      console.log("✅ Subscribed a", process.env.MQTT_TOPIC_LUCE_STATUS);
    }
  });
});

// --- Storage in memoria ---
let codes = {}; // { userCode: { user, expiry, expiresInSeconds } }
let logs = [];  // array di { user, code, action, timestamp }
let luceStatus = false; // Stato attuale della luce

// --- Helpers Upstash Redis ---
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisCmd(...args) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const res = await fetch(`${REDIS_URL}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const json = await res.json();
  return json.result ?? null;
}

async function loadFromRedis() {
  const keys = await redisCmd('keys', 'code:*') ?? [];
  for (const key of keys) {
    const raw = await redisCmd('get', key);
    if (!raw) continue;
    const entry = JSON.parse(raw);
    if (entry.expiry > Date.now()) {
      codes[key.replace('code:', '')] = entry;
    } else {
      logAction({ user: entry.user, code: key.replace('code:', ''), action: "EXPIRED" });
    }
  }
  const rawLogs = await redisCmd('lrange', 'logs', '0', '-1') ?? [];
  logs = rawLogs.map(r => JSON.parse(r));
  console.log(`✅ Redis: ${Object.keys(codes).length} codici, ${logs.length} log caricati`);
}
loadFromRedis().catch(err => console.error('❌ Errore caricamento Redis:', err));

// --- Gestione messaggi MQTT in arrivo ---
client.on("message", (topic, message) => {
  try {
    if (topic === process.env.MQTT_TOPIC_LUCE_STATUS) {
      const payload = JSON.parse(message.toString());

      let newStatus = null;

      // Gestisce NotifyStatus (notifiche automatiche)
      if (payload.params && payload.params["switch:0"]) {
        newStatus = payload.params["switch:0"].output;
      }
      // Gestisce risposta a Switch.GetStatus
      else if (payload.result && payload.result.output !== undefined) {
        newStatus = payload.result.output;
      }

      if (newStatus !== null) {
        luceStatus = newStatus;
        console.log(`💡 Stato luce aggiornato: ${newStatus ? "ACCESA" : "SPENTA"}`);
      }
    }
  } catch (err) {
    console.error("Errore parsing messaggio MQTT:", err);
  }
});

// --- Helper log ---
function logAction({ user, code, action }) {
  const entry = { user: user || "-", code: code || "-", action, timestamp: Date.now() };
  logs.push(entry);
  redisCmd('rpush', 'logs', JSON.stringify(entry))
    .then(() => redisCmd('ltrim', 'logs', '-1000', '-1'))
    .catch(() => {});
}

// --- ENDPOINT AUTENTICAZIONE ---

// Login
app.post("/admin/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Username e password richiesti" });
  }

  if (username !== ADMIN_USERNAME) {
    return res.status(401).json({ success: false, error: "Credenziali non valide" });
  }

  const isPasswordValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

  if (!isPasswordValid) {
    return res.status(401).json({ success: false, error: "Credenziali non valide" });
  }

  // Genera JWT token
  const token = jwt.sign(
    { username: username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({
    success: true,
    message: "Login effettuato con successo",
    token: token,
    username: username
  });
});

// Logout (lato client basta rimuovere il token, ma forniamo un endpoint per coerenza)
app.post("/admin/logout", (req, res) => {
  res.json({ success: true, message: "Logout effettuato con successo" });
});

// Verifica token
app.get("/admin/check-auth", requireAuth, (req, res) => {
  res.json({
    success: true,
    isAuthenticated: true,
    username: req.user.username
  });
});

// --- Endpoint utente: verifica codice ---
app.post("/verify-code", (req, res) => {
  const { userCode } = req.body;
  const entry = codes[userCode];
  const now = Date.now();

  if (!entry) {
    logAction({ user: "-", code: userCode, action: "INVALID" });
    return res.json({ success: false, error: "Codice non valido" });
  }

  if (now < entry.start) {
    logAction({ user: entry.user, code: userCode, action: "TOO_EARLY" });
    return res.json({ success: false, error: "Codice non ancora valido" });
  }

  if (now > entry.expiry) {
    logAction({ user: entry.user, code: userCode, action: "EXPIRED" });
    delete codes[userCode];
    return res.json({ success: false, error: "Codice scaduto" });
  }

  logAction({ user: entry.user, code: userCode, action: "VERIFIED" });
  res.json({ success: true, user: entry.user });
});

// --- Endpoint utente: invio comando a uno dei relè ---
app.post("/send-command", (req, res) => {
  const { userCode, relayId } = req.body;
  const entry = codes[userCode];
  const now = Date.now();

  if (!entry || now < entry.start || now > entry.expiry) {
    return res.status(400).json({ success: false, error: "Codice non valido o scaduto" });
  }

  const shellyPayload = JSON.stringify({
    id: 1,
    src: "webclient",
    method: "Switch.Set",
    params: {
      id: 0,
      on: true
    }
  });

  try {
    const topic =
      relayId === 2
        ? process.env.MQTT_TOPIC_RELAY2
        : process.env.MQTT_TOPIC_RELAY1;
        
    client.publish(topic, shellyPayload, { qos: 1 }, (err) => {
      if (err) {
        console.error("Errore invio comando a Shelly:", err);
        return res.status(500).json({ success: false, error: "MQTT publish failed" });
      }

      logAction({ user: entry.user, code: userCode, action: `ACTIVATED_RELAY_${relayId}` });
      res.json({ success: true, relayId, user: entry.user });
    });
  } catch (e) {
    console.error("Eccezione durante publish:", e);
    return res.status(500).json({ success: false, error: "Errore interno server" });
  }
});

// --- ENDPOINT ADMIN PROTETTI (richiedono autenticazione) ---

// Accendi luce
app.post("/admin/luce/on", requireAuth, (req, res) => {
  const shellyPayload = JSON.stringify({
    id: 1,
    src: "webclient",
    method: "Switch.Set",
    params: {
      id: 0,
      on: true
    }
  });

  client.publish(process.env.MQTT_TOPIC_LUCE, shellyPayload, { qos: 1 }, (err) => {
    if (err) {
      console.error("❌ Errore accensione luce:", err);
      return res.status(500).json({ success: false, error: "MQTT publish failed" });
    }
    
    console.log("💡 Comando ACCENSIONE luce inviato");
    res.json({ success: true, action: "on" });
  });
});

// Spegni luce
app.post("/admin/luce/off", requireAuth, (req, res) => {
  const shellyPayload = JSON.stringify({
    id: 1,
    src: "webclient",
    method: "Switch.Set",
    params: {
      id: 0,
      on: false
    }
  });

  client.publish(process.env.MQTT_TOPIC_LUCE, shellyPayload, { qos: 1 }, (err) => {
    if (err) {
      console.error("❌ Errore spegnimento luce:", err);
      return res.status(500).json({ success: false, error: "MQTT publish failed" });
    }
    
    console.log("💡 Comando SPEGNIMENTO luce inviato");
    res.json({ success: true, action: "off" });
  });
});

// Ottieni stato luce
app.get("/admin/luce/status", requireAuth, (req, res) => {
  res.json({ success: true, isOn: luceStatus });
});

// Sollecita status luce dallo Shelly
app.post("/admin/luce/request-status", requireAuth, (req, res) => {
  const shellyPayload = JSON.stringify({
    id: 1,
    src: "relay_luce/events",
    method: "Switch.GetStatus",
    params: { id: 0 }
  });

  client.publish(process.env.MQTT_TOPIC_LUCE, shellyPayload, { qos: 1 }, (err) => {
    if (err) {
      console.error("❌ Errore richiesta status luce:", err);
      return res.status(500).json({ success: false, error: "MQTT publish failed" });
    }

    console.log("📡 Richiesta status luce inviata");
    res.json({ success: true, message: "Status request sent" });
  });
});

// aziona relay (admin) - generico per relay 1 e 2
app.post("/admin/relay/:relayId", requireAuth, (req, res) => {
  const relayId = parseInt(req.params.relayId);
  
  if (relayId !== 1 && relayId !== 2) {
    return res.status(400).json({ success: false, error: "Relay ID non valido" });
  }

  const shellyPayload = JSON.stringify({
    id: 1,
    src: "webclient",
    method: "Switch.Set",
    params: {
      id: 0,
      on: true
    }
  });

  const topic = relayId === 2 
    ? process.env.MQTT_TOPIC_RELAY2 
    : process.env.MQTT_TOPIC_RELAY1;

  client.publish(topic, shellyPayload, { qos: 1 }, (err) => {
    if (err) {
      console.error(`❌ Errore apertura relay ${relayId}:`, err);
      return res.status(500).json({ success: false, error: "MQTT publish failed" });
    }
    
    console.log(`🔓 Comando apertura relay ${relayId} inviato (ADMIN)`);
    res.json({ success: true, relayId });
  });
});

// --- Endpoint admin: crea codice ---
app.post("/admin/create-code", requireAuth, (req, res) => {
  const { user, startDate, expiryDate } = req.body;

  try {
    const startUtc = DateTime.fromISO(startDate, { zone: 'Europe/Rome' }).toUTC().toMillis();
    const expiryUtc = DateTime.fromISO(expiryDate, { zone: 'Europe/Rome' }).toUTC().toMillis();

    if (isNaN(startUtc) || isNaN(expiryUtc)) {
      return res.status(400).json({ success: false, error: "Date non valide" });
    }

    if (expiryUtc <= startUtc) {
      return res.status(400).json({ success: false, error: "La data di fine deve essere successiva a quella di inizio" });
    }

    const code = Math.floor(10000 + Math.random() * 90000).toString();

    codes[code] = { user, start: startUtc, expiry: expiryUtc };

    const ttl = Math.max(1, Math.floor((expiryUtc - Date.now()) / 1000));
    redisCmd('set', `code:${code}`, JSON.stringify({ user, start: startUtc, expiry: expiryUtc }), 'EX', String(ttl))
      .catch(err => console.error('❌ Redis set error:', err));

    logAction({ user, code, action: "CREATED" });

    res.json({
      success: true,
      code,
      user,
      start: startUtc,
      expiry: expiryUtc
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: "Errore interno" });
  }
});

// --- Endpoint admin: lista codici ---
app.get("/admin/list-codes", requireAuth, (req, res) => {
  const activeCodes = Object.entries(codes).map(([code, entry]) => {
    const now = Date.now();
    const expiresInSeconds = Math.floor((entry.expiry - now) / 1000);
    return { code, user: entry.user, start: entry.start, expiry: entry.expiry, expiresInSeconds };
  });
  res.json({ activeCodes });
});

// --- Endpoint admin: elimina codice ---
app.delete("/admin/delete-code/:code", requireAuth, (req, res) => {
  const code = req.params.code;
  if (codes[code]) {
    const user = codes[code].user;
    delete codes[code];
    redisCmd('del', `code:${code}`).catch(() => {});
    logAction({ user, code, action: "DELETED" });
    return res.json({ success: true });
  }
  res.json({ success: false, error: "Codice non trovato" });
});

// --- Endpoint admin: log ---
app.get("/admin/logs", requireAuth, (req, res) => {
  res.json({ logs });
});

// --- Controllo automatico codici scaduti ---
setInterval(() => {
  const now = Date.now();
  Object.entries(codes).forEach(([code, entry]) => {
    if (entry.expiry <= now) {
      logAction({ user: entry.user, code, action: "EXPIRED" });
      delete codes[code];
      redisCmd('del', `code:${code}`).catch(() => {});
      console.log(`Codice ${code} di ${entry.user} è scaduto e rimosso.`);
    } else {
      entry.expiresInSeconds = Math.floor((entry.expiry - now) / 1000);
    }
  });
}, 60 * 1000);

// --- Endpoint ping di risveglio ---
app.get("/ping", (req, res) => {
  res.json({ success: true, message: "Backend attivo" });
});

// --- Avvio server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server avviato su http://localhost:${PORT}`));