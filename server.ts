import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  // Auth Middleware
  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const authSession = req.cookies.admin_session;
    if (authSession === "authorized") {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

  // Login Endpoint
  app.post("/api/login", async (req, res) => {
    const { password } = req.body;
    
    console.log("[Auth] Login attempt...");
    
    if (!ADMIN_PASSWORD) {
      console.error("[Auth] ADMIN_PASSWORD is not set in environment variables.");
      return res.status(500).json({ error: "Password Admin BELUM DIATUR di panel Secrets (gunakan variabel ADMIN_PASSWORD)." });
    }

    if (password !== ADMIN_PASSWORD) {
      console.warn("[Auth] Invalid password attempt.");
      return res.status(401).json({ error: "Password salah!" });
    }

    console.log("[Auth] Login successful.");
    res.cookie("admin_session", "authorized", {
      httpOnly: true,
      secure: true,
      sameSite: "none", // Required for cookies in iframes
      maxAge: 3600000, // 1 hour
    });
    res.json({ success: true });
  });

  app.post("/api/logout", (req, res) => {
    res.clearCookie("admin_session", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
    });
    res.json({ success: true });
  });

  app.get("/api/auth/status", (req, res) => {
    const authSession = req.cookies.admin_session;
    res.json({ authenticated: authSession === "authorized" });
  });

  // Helper to clean Google Private Key
  const cleanPrivateKey = (key?: string) => {
    if (!key) return undefined;
    // Remove quotes if present at start/end
    let cleaned = key.trim();
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.substring(1, cleaned.length - 1);
    }
    // Replace escaped newlines
    return cleaned.replace(/\\n/g, "\n");
  };

  const privateKey = cleanPrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  if (serviceAccountEmail) {
    console.log(`[Google Sheets] Initializing with Service Account: ${serviceAccountEmail}`);
  } else {
    console.warn("[Google Sheets] Warning: GOOGLE_SERVICE_ACCOUNT_EMAIL is not set.");
  }

  // Google Sheets Auth
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const multer = (await import("multer")).default;
  const upload = multer({ storage: multer.memoryStorage() });

  // API Routes
  app.post("/api/upload", authenticate, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileMetadata = {
        name: req.file.originalname,
      };
      
      const media = {
        mimeType: req.file.mimetype,
        body: require("stream").Readable.from(req.file.buffer),
      };

      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, webViewLink",
      });

      // Make the file publicly accessible
      await drive.permissions.create({
        fileId: file.data.id!,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });

      res.json({ url: file.data.webViewLink });
    } catch (error: any) {
      console.error("Error uploading file:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Routes
  app.get("/api/sheets", async (req, res) => {
    try {
      if (!spreadsheetId) {
        return res.status(400).json({ error: "GOOGLE_SHEET_ID is not configured." });
      }
      const response = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetNames = response.data.sheets?.map(s => s.properties?.title).filter(Boolean);
      res.json(sheetNames);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/data", async (req, res) => {
    try {
      const sheetName = req.query.sheet as string || "Sheet1";
      // Wrap sheet name in single quotes in case it contains spaces or special characters
      const range = `'${sheetName}'!A5:Z`; 
      
      console.log(`[Google Sheets] Fetching data from: ${spreadsheetId}, Range: ${range}`);
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "GOOGLE_SHEET_ID is not configured in environment variables." });
      }

      if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !privateKey) {
        return res.status(400).json({ 
          error: "Google Sheets credentials are not fully configured. Please check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY." 
        });
      }

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.json({ headers: [], data: [] });
      }

      // First row (Row 5 in Sheet) is header
      const headers = rows[0];
      const data = rows.slice(1).map((row, index) => {
        const obj: any = { id: index };
        headers.forEach((header, i) => {
          obj[header] = row[i] || "";
        });
        return obj;
      });

      res.json({ headers, data });
    } catch (error: any) {
      console.error("Error fetching sheets data:", error);
      
      // Specialize error messages for common Google Auth issues
      let friendlyMessage = error.message;
      if (error.message?.includes("invalid_grant") && error.message?.includes("account not found")) {
        friendlyMessage = `Gagal login: Email Service Account "${serviceAccountEmail}" tidak temukan. Pastikan email ini persis sama dengan yang ada di file JSON key Anda.`;
      } else if (error.message?.includes("DECODER routines")) {
        friendlyMessage = "Gagal memproses Private Key. Pastikan format GOOGLE_PRIVATE_KEY benar (cek petunjuk di .env.example).";
      } else if (error.message?.includes("Unable to parse range")) {
        friendlyMessage = `Format range tidak valid. Pastikan nama sheet benar. Jika range hanya berupa angka, Google Sheets API akan gagal memprosesnya.`;
      }

      res.status(500).json({ error: friendlyMessage });
    }
  });

  app.post("/api/data", authenticate, async (req, res) => {
    try {
      const sheetName = req.query.sheet as string || "Sheet1";
      const range = `'${sheetName}'!A5:Z`;

      if (!spreadsheetId) {
        return res.status(400).json({ error: "Spreadsheet ID not configured" });
      }

      const { values } = req.body; // Expecting an array [NO, KETERANGAN, ...]
      
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [values],
        },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error appending sheets data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/data/:id", authenticate, async (req, res) => {
    try {
      const sheetName = req.query.sheet as string || "Sheet1";
      const { id } = req.params;
      const { values } = req.body;

      if (!spreadsheetId) {
        return res.status(400).json({ error: "Spreadsheet ID not configured" });
      }

      // data starts at row 6. id 0 is row 6.
      const rowIndex = parseInt(id) + 6;
      const range = `'${sheetName}'!A${rowIndex}:Z${rowIndex}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [values],
        },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating sheets data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/data/:id", authenticate, async (req, res) => {
    try {
      const sheetName = req.query.sheet as string || "Sheet1";
      const { id } = req.params;

      if (!spreadsheetId) {
        return res.status(400).json({ error: "Spreadsheet ID not configured" });
      }

      // 1. Get the sheet ID for the specified sheet name
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const sheet = spreadsheet.data.sheets?.find(s => s.properties?.title === sheetName);
      
      if (!sheet || sheet.properties?.sheetId === undefined) {
        return res.status(404).json({ error: `Sheet "${sheetName}" not found` });
      }

      const sheetId = sheet.properties.sheetId;
      // Data starts at row 6. id 0 corresponds to row index 5 (0-indexed) for the API
      // Since our rowIndex for update was parseInt(id) + 6 (which is human-readable row number)
      // The API deleteDimension uses 0-indexed values.
      // id 0 -> Row 6 -> Index 5
      const rowIndex = parseInt(id) + 5;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: sheetId,
                  dimension: "ROWS",
                  startIndex: rowIndex,
                  endIndex: rowIndex + 1,
                },
              },
            },
          ],
        },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting sheets data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
