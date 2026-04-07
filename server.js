const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const DB_PATH = path.join(DATA_DIR, "pathlab.sqlite");
const LEGACY_STORE_PATH = path.join(DATA_DIR, "store.json");
const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const defaultSeedReports = {
  PLHC1024: {
    patient: "Ananya Sharma",
    phoneNumber: null,
    packageName: "Full Body Checkup",
    status: "Ready for download",
    badgeClass: "ready",
    collectedOn: "07 Apr 2026, 7:30 AM",
    doctorNote: "Most values are within the expected range. Vitamin D follow-up is advised.",
    reportItems: [
      "CBC, lipid profile, kidney function test",
      "Liver function test and thyroid screening",
      "Urine routine summary included"
    ],
    downloadLabel: "Download report",
    canDownload: true
  },
  PLHC2048: {
    patient: "Rahul Mehta",
    phoneNumber: null,
    packageName: "Diabetes Care Panel",
    status: "Processing in lab",
    badgeClass: "processing",
    collectedOn: "07 Apr 2026, 9:10 AM",
    doctorNote: "Sample received and primary biomarkers are under processing.",
    reportItems: [
      "HbA1c analysis underway",
      "Fasting glucose completed",
      "Kidney markers pending review"
    ],
    downloadLabel: "Download report",
    canDownload: false
  },
  PLHC3096: {
    patient: "Sushila Verma",
    phoneNumber: null,
    packageName: "Thyroid Profile",
    status: "Under doctor review",
    badgeClass: "review",
    collectedOn: "06 Apr 2026, 6:15 PM",
    doctorNote: "Lab values are ready and awaiting final clinical sign-off.",
    reportItems: [
      "TSH completed",
      "T3 and T4 validated",
      "Final signature pending"
    ],
    downloadLabel: "Download summary",
    canDownload: true
  }
};

let db = null;
let databaseKind = DATABASE_URL ? "postgres" : "sqlite";

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(requestUrl.pathname);

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }

    serveStaticFile(pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

startServer();

async function startServer() {
  try {
    await initializeDatabase();
    server.listen(PORT, () => {
      console.log(`PathLab Home Care server running at http://localhost:${PORT} using ${databaseKind}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

async function initializeDatabase() {
  if (databaseKind === "postgres") {
    const { Pool } = require("pg");
    db = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("render.com")
        ? { rejectUnauthorized: false }
        : undefined
    });
  } else {
    ensureDataDir();
    const { DatabaseSync } = require("node:sqlite");
    db = new DatabaseSync(DB_PATH);
  }

  await setupDatabase();
  await runMigrations();
  await seedDatabase();
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, date: new Date().toISOString(), database: databaseKind });
    return;
  }

  if (req.method === "POST" && pathname === "/api/appointments") {
    const body = await readJsonBody(req);
    const requiredFields = ["patientName", "phoneNumber", "address", "city", "appointmentDate", "packageName", "timeSlot"];
    const missingField = requiredFields.find((field) => !body[field]);

    if (missingField) {
      sendJson(res, 400, { error: `Missing field: ${missingField}` });
      return;
    }

    const patientName = String(body.patientName).trim();
    const phoneNumber = normalizePhoneNumber(body.phoneNumber);
    const address = String(body.address).trim();
    const city = String(body.city).trim();
    const appointmentDate = String(body.appointmentDate).trim();
    const packageName = String(body.packageName).trim();
    const timeSlot = String(body.timeSlot).trim();
    const notes = String(body.notes || "").trim();

    if (!phoneNumber) {
      sendJson(res, 400, { error: "Valid phone number is required" });
      return;
    }

    const bookingId = await generateUniqueId("appointments", "booking_id", "PLB");
    const reportId = await generateUniqueId("reports", "report_id", "PLR");
    const createdAt = new Date().toISOString();

    await dbRun(`
      INSERT INTO appointments (
        booking_id, report_id, patient_name, phone_number, address, city,
        appointment_date, package_name, time_slot, notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      bookingId,
      reportId,
      patientName,
      phoneNumber,
      address,
      city,
      appointmentDate,
      packageName,
      timeSlot,
      notes,
      "Appointment confirmed",
      createdAt
    ]);

    await dbRun(`
      INSERT INTO reports (
        report_id, patient_name, phone_number, package_name, status, badge_class,
        collected_on, doctor_note, report_items, download_label, can_download, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      reportId,
      patientName,
      phoneNumber,
      packageName,
      "Appointment booked",
      "processing",
      `${appointmentDate}, ${timeSlot}`,
      "Your appointment is booked. Report status will update after sample collection and lab processing.",
      JSON.stringify([
        "Appointment created successfully",
        "Sample collection pending",
        "Lab processing will begin after collection"
      ]),
      "Download report",
      false,
      createdAt
    ]);

    sendJson(res, 201, serializeAppointment(await getAppointmentByBookingId(bookingId)));
    return;
  }

  if (req.method === "GET" && pathname === "/api/appointments") {
    const rows = await dbAll("SELECT * FROM appointments ORDER BY created_at DESC");
    sendJson(res, 200, rows.map(serializeAppointment));
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/request-otp") {
    const body = await readJsonBody(req);
    const phoneNumber = normalizePhoneNumber(body.phoneNumber);

    if (!phoneNumber) {
      sendJson(res, 400, { error: "Valid phone number is required" });
      return;
    }

    const patient = await dbGet(`
      SELECT patient_name, phone_number
      FROM appointments
      WHERE phone_number = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [phoneNumber]);

    if (!patient) {
      sendJson(res, 404, { error: "No patient account found for this phone number. Book a test first." });
      return;
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const now = Date.now();

    await dbRun("UPDATE otp_codes SET consumed_at = ? WHERE phone_number = ? AND consumed_at IS NULL", [now, phoneNumber]);
    await dbRun("INSERT INTO otp_codes (phone_number, code, expires_at, created_at) VALUES (?, ?, ?, ?)", [
      phoneNumber,
      otp,
      now + OTP_TTL_MS,
      now
    ]);

    const delivery = await sendOtpMessage(phoneNumber, otp);

    sendJson(res, 200, {
      message: delivery.mode === "sms"
        ? "OTP sent to the registered mobile number."
        : "OTP generated for the registered mobile number.",
      deliveryMode: delivery.mode,
      demoOtp: delivery.mode === "demo" ? otp : null,
      phoneNumber,
      expiresInMinutes: 10
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/verify-otp") {
    const body = await readJsonBody(req);
    const phoneNumber = normalizePhoneNumber(body.phoneNumber);
    const otp = String(body.otp || "").trim();

    if (!phoneNumber || !otp) {
      sendJson(res, 400, { error: "Phone number and OTP are required" });
      return;
    }

    const now = Date.now();
    const otpRecord = await dbGet(`
      SELECT id
      FROM otp_codes
      WHERE phone_number = ? AND code = ? AND consumed_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [phoneNumber, otp, now]);

    if (!otpRecord) {
      sendJson(res, 401, { error: "Invalid or expired OTP" });
      return;
    }

    await dbRun("UPDATE otp_codes SET consumed_at = ? WHERE id = ?", [now, otpRecord.id]);

    const token = crypto.randomBytes(24).toString("hex");
    await dbRun("INSERT INTO patient_sessions (phone_number, token, expires_at, created_at) VALUES (?, ?, ?, ?)", [
      phoneNumber,
      token,
      now + SESSION_TTL_MS,
      now
    ]);

    setCookie(res, "patient_session", token, SESSION_TTL_MS);
    sendJson(res, 200, { ok: true, message: "Patient login successful" });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const sessionToken = getCookie(req, "patient_session");
    if (sessionToken) {
      await dbRun("DELETE FROM patient_sessions WHERE token = ?", [sessionToken]);
    }

    clearCookie(res, "patient_session");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/patient/dashboard") {
    const session = await getPatientSession(req);

    if (!session) {
      sendJson(res, 401, { error: "Patient login required" });
      return;
    }

    const patient = await dbGet(`
      SELECT patient_name, phone_number
      FROM appointments
      WHERE phone_number = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [session.phoneNumber]);

    const appointments = (await dbAll(`
      SELECT * FROM appointments
      WHERE phone_number = ?
      ORDER BY created_at DESC
    `, [session.phoneNumber])).map(serializeAppointment);

    const reports = (await dbAll(`
      SELECT * FROM reports
      WHERE phone_number = ?
      ORDER BY updated_at DESC
    `, [session.phoneNumber])).map(serializeReport);

    sendJson(res, 200, {
      patient: {
        patientName: patient ? patient.patient_name : "Patient",
        phoneNumber: session.phoneNumber
      },
      appointments,
      reports
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/overview") {
    const session = await getAdminSession(req);
    if (!session) {
      sendJson(res, 401, { error: "Admin login required" });
      return;
    }
    sendJson(res, 200, await getAdminOverview());
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/me") {
    const session = await getAdminSession(req);
    if (!session) {
      sendJson(res, 401, { error: "Admin login required" });
      return;
    }

    sendJson(res, 200, { ok: true, username: session.username });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    const body = await readJsonBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      sendJson(res, 401, { error: "Invalid admin credentials" });
      return;
    }

    const now = Date.now();
    const token = crypto.randomBytes(24).toString("hex");

    await dbRun("INSERT INTO admin_sessions (username, token, expires_at, created_at) VALUES (?, ?, ?, ?)", [
      username,
      token,
      now + ADMIN_SESSION_TTL_MS,
      now
    ]);

    setCookie(res, "admin_session", token, ADMIN_SESSION_TTL_MS);
    sendJson(res, 200, { ok: true, username });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/logout") {
    const sessionToken = getCookie(req, "admin_session");
    if (sessionToken) {
      await dbRun("DELETE FROM admin_sessions WHERE token = ?", [sessionToken]);
    }

    clearCookie(res, "admin_session");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/appointments") {
    const session = await getAdminSession(req);
    if (!session) {
      sendJson(res, 401, { error: "Admin login required" });
      return;
    }
    const appointments = (await dbAll("SELECT * FROM appointments ORDER BY created_at DESC")).map(serializeAppointment);
    sendJson(res, 200, appointments);
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/reports") {
    const session = await getAdminSession(req);
    if (!session) {
      sendJson(res, 401, { error: "Admin login required" });
      return;
    }
    const reports = (await dbAll("SELECT * FROM reports ORDER BY updated_at DESC")).map(serializeReport);
    sendJson(res, 200, reports);
    return;
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/admin/reports/")) {
    const session = await getAdminSession(req);
    if (!session) {
      sendJson(res, 401, { error: "Admin login required" });
      return;
    }

    const reportId = pathname.split("/").pop().toUpperCase();
    const existingRow = await getReportRowById(reportId);

    if (!existingRow) {
      sendJson(res, 404, { error: "Report not found" });
      return;
    }

    const existingReport = serializeReport(existingRow);
    const body = await readJsonBody(req);
    const status = String(body.status || existingReport.status).trim();
    const canDownload = body.canDownload === undefined ? existingReport.canDownload : Boolean(body.canDownload);
    const badgeClass = String(body.badgeClass || inferBadgeClass(status, canDownload)).trim();
    const doctorNote = String(body.doctorNote || existingReport.doctorNote).trim();
    const collectedOn = String(body.collectedOn || existingReport.collectedOn).trim();
    const downloadLabel = String(body.downloadLabel || existingReport.downloadLabel || "Download report").trim();
    const reportItems = Array.isArray(body.reportItems)
      ? body.reportItems
      : String(body.reportItems || "")
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);

    let uploadedFile = null;

    try {
      uploadedFile = normalizeUploadedReportFile(body.reportFile);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }

    const reportFileName = uploadedFile ? buildStoredReportFileName(reportId, uploadedFile.name) : (existingRow.report_file_name || "");
    const reportFileMime = uploadedFile ? uploadedFile.contentType : (existingRow.report_file_mime || "");
    const reportFileDataBase64 = uploadedFile ? uploadedFile.dataBase64 : (existingRow.report_file_data_base64 || "");
    const reportFilePath = uploadedFile ? "" : (existingRow.report_file_path || "");

    await dbRun(`
      UPDATE reports
      SET status = ?, badge_class = ?, collected_on = ?, doctor_note = ?, report_items = ?, download_label = ?, can_download = ?, updated_at = ?,
          report_file_name = ?, report_file_path = ?, report_file_mime = ?, report_file_data_base64 = ?
      WHERE report_id = ?
    `, [
      status,
      badgeClass,
      collectedOn,
      doctorNote,
      JSON.stringify(reportItems.length ? reportItems : existingReport.reportItems),
      downloadLabel,
      canDownload,
      new Date().toISOString(),
      reportFileName,
      reportFilePath,
      reportFileMime,
      reportFileDataBase64,
      reportId
    ]);

    sendJson(res, 200, await getReportById(reportId));
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/reports/")) {
    const reportId = pathname.split("/").pop().toUpperCase();
    const report = await getReportById(reportId);

    if (!report) {
      sendJson(res, 404, { error: "Report not found" });
      return;
    }

    sendJson(res, 200, report);
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/download-report/")) {
    const reportId = pathname.split("/").pop().toUpperCase();
    const reportRow = await getReportRowById(reportId);
    const report = reportRow ? serializeReport(reportRow) : null;

    if (!report) {
      sendText(res, 404, "Report not found");
      return;
    }

    if (!report.canDownload) {
      sendText(res, 400, "Report is not ready for download yet");
      return;
    }

    if (reportRow.report_file_data_base64) {
      const buffer = Buffer.from(reportRow.report_file_data_base64, "base64");
      res.writeHead(200, {
        "Content-Type": report.reportFileMime || "application/pdf",
        "Content-Disposition": `attachment; filename="${report.reportFileName || `${reportId}.pdf`}"`,
        "Content-Length": buffer.length
      });
      res.end(buffer);
      return;
    }

    if (report.reportFilePath) {
      const filePath = path.join(ROOT_DIR, report.reportFilePath);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, {
          "Content-Type": report.reportFileMime || "application/pdf",
          "Content-Disposition": `attachment; filename="${report.reportFileName || `${reportId}.pdf`}"`,
          "Content-Length": fs.statSync(filePath).size
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    const reportContent = [
      "PathLab Home Care",
      `Report ID: ${reportId}`,
      `Patient: ${report.patient}`,
      `Package: ${report.packageName}`,
      `Status: ${report.status}`,
      `Collected On: ${report.collectedOn}`,
      `Last Updated: ${report.updatedOn}`,
      "",
      "Included Items:",
      ...report.reportItems.map((item, index) => `${index + 1}. ${item}`),
      "",
      `Doctor Note: ${report.doctorNote}`
    ].join("\n");

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportId}-report.txt"`
    });
    res.end(reportContent);
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

function serveStaticFile(pathname, res) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT_DIR, requestedPath));

  if (!filePath.startsWith(ROOT_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    res.end(content);
  });
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

async function setupDatabase() {
  const statements = databaseKind === "postgres"
    ? [
        `CREATE TABLE IF NOT EXISTS appointments (
          id SERIAL PRIMARY KEY,
          booking_id TEXT NOT NULL UNIQUE,
          report_id TEXT NOT NULL UNIQUE,
          patient_name TEXT NOT NULL,
          phone_number TEXT NOT NULL,
          address TEXT NOT NULL,
          city TEXT NOT NULL,
          appointment_date TEXT NOT NULL,
          package_name TEXT NOT NULL,
          time_slot TEXT NOT NULL,
          notes TEXT DEFAULT '',
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS reports (
          id SERIAL PRIMARY KEY,
          report_id TEXT NOT NULL UNIQUE,
          patient_name TEXT NOT NULL,
          phone_number TEXT,
          package_name TEXT NOT NULL,
          status TEXT NOT NULL,
          badge_class TEXT NOT NULL,
          collected_on TEXT NOT NULL,
          doctor_note TEXT NOT NULL,
          report_items TEXT NOT NULL,
          download_label TEXT NOT NULL,
          can_download BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TEXT NOT NULL,
          report_file_name TEXT,
          report_file_path TEXT,
          report_file_mime TEXT,
          report_file_data_base64 TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS otp_codes (
          id SERIAL PRIMARY KEY,
          phone_number TEXT NOT NULL,
          code TEXT NOT NULL,
          expires_at BIGINT NOT NULL,
          consumed_at BIGINT,
          created_at BIGINT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS patient_sessions (
          id SERIAL PRIMARY KEY,
          phone_number TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          expires_at BIGINT NOT NULL,
          created_at BIGINT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS admin_sessions (
          id SERIAL PRIMARY KEY,
          username TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          expires_at BIGINT NOT NULL,
          created_at BIGINT NOT NULL
        )`
      ]
    : [
        `CREATE TABLE IF NOT EXISTS appointments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_id TEXT NOT NULL UNIQUE,
          report_id TEXT NOT NULL UNIQUE,
          patient_name TEXT NOT NULL,
          phone_number TEXT NOT NULL,
          address TEXT NOT NULL,
          city TEXT NOT NULL,
          appointment_date TEXT NOT NULL,
          package_name TEXT NOT NULL,
          time_slot TEXT NOT NULL,
          notes TEXT DEFAULT '',
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          report_id TEXT NOT NULL UNIQUE,
          patient_name TEXT NOT NULL,
          phone_number TEXT,
          package_name TEXT NOT NULL,
          status TEXT NOT NULL,
          badge_class TEXT NOT NULL,
          collected_on TEXT NOT NULL,
          doctor_note TEXT NOT NULL,
          report_items TEXT NOT NULL,
          download_label TEXT NOT NULL,
          can_download INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          report_file_name TEXT,
          report_file_path TEXT,
          report_file_mime TEXT,
          report_file_data_base64 TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS otp_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone_number TEXT NOT NULL,
          code TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS patient_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone_number TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS admin_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`
      ];

  for (const statement of statements) {
    await dbExec(statement);
  }
}

async function runMigrations() {
  await ensureColumnExists("reports", "report_file_name", "TEXT");
  await ensureColumnExists("reports", "report_file_path", "TEXT");
  await ensureColumnExists("reports", "report_file_mime", "TEXT");
  await ensureColumnExists("reports", "report_file_data_base64", "TEXT");
}

async function seedDatabase() {
  const appointmentCount = await getCount("SELECT COUNT(*) AS count FROM appointments");
  const reportCount = await getCount("SELECT COUNT(*) AS count FROM reports");

  if (appointmentCount || reportCount) {
    return;
  }

  let legacyStore = null;

  if (fs.existsSync(LEGACY_STORE_PATH)) {
    try {
      legacyStore = JSON.parse(fs.readFileSync(LEGACY_STORE_PATH, "utf-8"));
    } catch (error) {
      legacyStore = null;
    }
  }

  const legacyAppointments = legacyStore?.appointments || [];
  const legacyReports = legacyStore?.reports || defaultSeedReports;

  for (const appointment of legacyAppointments) {
    const bookingId = appointment.bookingId || await generateUniqueId("appointments", "booking_id", "PLB");
    const reportId = appointment.reportId || await generateUniqueId("reports", "report_id", "PLR");

    await insertIgnore(`
      INSERT INTO appointments (
        booking_id, report_id, patient_name, phone_number, address, city,
        appointment_date, package_name, time_slot, notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      bookingId,
      reportId,
      appointment.patientName || "Patient",
      normalizePhoneNumber(appointment.phoneNumber) || "9999999999",
      appointment.address || "Address unavailable",
      appointment.city || "City unavailable",
      appointment.appointmentDate || "2026-04-08",
      appointment.packageName || "Full Body Checkup",
      appointment.timeSlot || "9:00 AM - 10:00 AM",
      appointment.notes || "",
      appointment.status || "Appointment confirmed",
      new Date().toISOString()
    ]);
  }

  for (const [reportId, report] of Object.entries(legacyReports)) {
    const appointmentForReport = legacyAppointments.find((appointment) => appointment.reportId === reportId);

    await insertIgnore(`
      INSERT INTO reports (
        report_id, patient_name, phone_number, package_name, status, badge_class,
        collected_on, doctor_note, report_items, download_label, can_download, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      reportId,
      report.patient || "Patient",
      normalizePhoneNumber(report.phoneNumber || appointmentForReport?.phoneNumber) || null,
      report.packageName || "Pathology Test",
      report.status || "Processing in lab",
      report.badgeClass || inferBadgeClass(report.status, report.canDownload),
      report.collectedOn || "Collection pending",
      report.doctorNote || "Report update pending.",
      JSON.stringify(report.reportItems || []),
      report.downloadLabel || "Download report",
      Boolean(report.canDownload),
      new Date().toISOString()
    ]);
  }
}

async function getAppointmentByBookingId(bookingId) {
  return await dbGet("SELECT * FROM appointments WHERE booking_id = ? LIMIT 1", [bookingId]);
}

async function getReportRowById(reportId) {
  return await dbGet("SELECT * FROM reports WHERE report_id = ? LIMIT 1", [reportId]);
}

async function getReportById(reportId) {
  const row = await getReportRowById(reportId);
  return row ? serializeReport(row) : null;
}

async function getAdminOverview() {
  return {
    totalAppointments: await getCount("SELECT COUNT(*) AS count FROM appointments"),
    totalReports: await getCount("SELECT COUNT(*) AS count FROM reports"),
    readyReports: await getCount("SELECT COUNT(*) AS count FROM reports WHERE can_download = ?", [databaseKind === "postgres" ? true : 1]),
    pendingReports: await getCount("SELECT COUNT(*) AS count FROM reports WHERE can_download = ?", [databaseKind === "postgres" ? false : 0])
  };
}

function serializeAppointment(row) {
  return {
    bookingId: row.booking_id,
    reportId: row.report_id,
    patientName: row.patient_name,
    phoneNumber: row.phone_number,
    address: row.address,
    city: row.city,
    appointmentDate: row.appointment_date,
    packageName: row.package_name,
    timeSlot: row.time_slot,
    notes: row.notes,
    status: row.status,
    createdAt: formatDisplayDateTime(row.created_at)
  };
}

function serializeReport(row) {
  return {
    reportId: row.report_id,
    patient: row.patient_name,
    phoneNumber: row.phone_number,
    packageName: row.package_name,
    status: row.status,
    badgeClass: row.badge_class,
    collectedOn: row.collected_on,
    updatedOn: formatDisplayDateTime(row.updated_at),
    doctorNote: row.doctor_note,
    reportItems: JSON.parse(row.report_items || "[]"),
    downloadLabel: row.download_label,
    canDownload: normalizeBoolean(row.can_download),
    reportFileName: row.report_file_name || "",
    reportFilePath: row.report_file_path || "",
    reportFileMime: row.report_file_mime || "",
    hasPdf: Boolean(row.report_file_data_base64 || row.report_file_path)
  };
}

async function generateUniqueId(table, column, prefix) {
  let identifier = "";
  let exists = true;

  while (exists) {
    identifier = `${prefix}${Math.floor(1000 + Math.random() * 9000)}`;
    exists = Boolean(await dbGet(`SELECT 1 AS exists_value FROM ${table} WHERE ${column} = ? LIMIT 1`, [identifier]));
  }

  return identifier;
}

function inferBadgeClass(status, canDownload) {
  if (canDownload || /ready/i.test(status || "")) {
    return "ready";
  }

  if (/review/i.test(status || "")) {
    return "review";
  }

  return "processing";
}

function normalizePhoneNumber(phoneNumber) {
  const digits = String(phoneNumber || "").replace(/\D/g, "");
  if (digits.length < 10) {
    return "";
  }

  return digits.slice(-10);
}

function formatDisplayDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

async function getPatientSession(req) {
  const token = getCookie(req, "patient_session");

  if (!token) {
    return null;
  }

  const now = Date.now();
  const session = await dbGet(`
    SELECT phone_number, token, expires_at
    FROM patient_sessions
    WHERE token = ? AND expires_at > ?
    LIMIT 1
  `, [token, now]);

  if (!session) {
    return null;
  }

  return {
    phoneNumber: session.phone_number,
    token: session.token
  };
}

async function getAdminSession(req) {
  const token = getCookie(req, "admin_session");

  if (!token) {
    return null;
  }

  const now = Date.now();
  const session = await dbGet(`
    SELECT username, token, expires_at
    FROM admin_sessions
    WHERE token = ? AND expires_at > ?
    LIMIT 1
  `, [token, now]);

  if (!session) {
    return null;
  }

  return {
    username: session.username,
    token: session.token
  };
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return "";
  }

  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const entry = cookies.find((item) => item.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.split("=").slice(1).join("=")) : "";
}

function setCookie(res, name, value, maxAgeMs) {
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; SameSite=Lax`);
}

function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

async function ensureColumnExists(tableName, columnName, columnDefinition) {
  if (databaseKind === "postgres") {
    await dbExec(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${columnDefinition}`);
    return;
  }

  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

function normalizeUploadedReportFile(file) {
  if (!file || typeof file !== "object") {
    return null;
  }

  const name = String(file.name || "").trim();
  const contentType = String(file.contentType || "").trim();
  const dataBase64 = String(file.dataBase64 || "").trim();

  if (!name || !contentType || !dataBase64) {
    return null;
  }

  if (contentType !== "application/pdf" || !name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only PDF report uploads are supported");
  }

  return { name, contentType, dataBase64 };
}

function buildStoredReportFileName(reportId, originalName) {
  const safeBaseName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "-");
  return `${reportId}-${Date.now()}-${safeBaseName}`;
}

async function sendOtpMessage(phoneNumber, otp) {
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
    const body = new URLSearchParams({
      To: `+91${phoneNumber}`,
      From: TWILIO_FROM_NUMBER,
      Body: `PathLab Home Care OTP: ${otp}. Valid for 10 minutes.`
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SMS delivery failed: ${errorText}`);
    }

    return { mode: "sms" };
  }

  return { mode: "demo" };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = "";

    req.on("data", (chunk) => {
      rawBody += chunk;
      if (rawBody.length > 1e6) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });

    req.on("end", () => {
      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

async function dbExec(sql) {
  if (databaseKind === "postgres") {
    await db.query(sql);
    return;
  }

  db.exec(sql);
}

async function dbGet(sql, params = []) {
  if (databaseKind === "postgres") {
    const result = await db.query(toPostgresSql(sql), params);
    return result.rows[0] || null;
  }

  return db.prepare(sql).get(...params) || null;
}

async function dbAll(sql, params = []) {
  if (databaseKind === "postgres") {
    const result = await db.query(toPostgresSql(sql), params);
    return result.rows;
  }

  return db.prepare(sql).all(...params);
}

async function dbRun(sql, params = []) {
  if (databaseKind === "postgres") {
    const result = await db.query(toPostgresSql(sql), params);
    return { changes: result.rowCount };
  }

  return db.prepare(sql).run(...params);
}

async function insertIgnore(sql, params = []) {
  if (databaseKind === "postgres") {
    const normalized = sql.replace(/\s+/g, " ").replace(/INSERT INTO/i, "INSERT INTO");
    let withConflict = normalized;

    if (/INSERT INTO appointments/i.test(normalized)) {
      withConflict = `${normalized} ON CONFLICT (booking_id) DO NOTHING`;
    } else if (/INSERT INTO reports/i.test(normalized)) {
      withConflict = `${normalized} ON CONFLICT (report_id) DO NOTHING`;
    }

    await db.query(toPostgresSql(withConflict), params);
    return;
  }

  const sqliteSql = sql.replace(/INSERT INTO/i, "INSERT OR IGNORE INTO");
  db.prepare(sqliteSql).run(...params);
}

async function getCount(sql, params = []) {
  const row = await dbGet(sql, params);
  return Number(row?.count || 0);
}

function toPostgresSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1";
}
