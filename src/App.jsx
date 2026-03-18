import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "siku365-entries-v4";
const READ_KEY = "siku365-read-v4";
const today = new Date();
const PRELOADED = {};

function monthNameFromNumber(n) {
  return [
    "",
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ][n] || "";
}

function normalizeMonthNumber(entry) {
  if (entry?.monthNumber) return Number(entry.monthNumber);

  const raw = String(entry?.month || entry?.date || "").toLowerCase();

  const map = {
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, machi: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sept: 9, sep: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12
  };

  for (const [name, num] of Object.entries(map)) {
    if (raw.includes(name)) return num;
  }

  return null;
}

function makeEntryKey(monthNumber, day) {
  return `${monthNumber}-${day}`;
}

function formatMonthDay(monthNumber, day) {
  const month = monthNameFromNumber(monthNumber);
  return month && day ? `${month} ${day}` : "";
}

function firstNonEmpty(values) {
  return values.find((v) => String(v || "").trim()) || "";
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const out = [];

  for (const v of values) {
    const clean = String(v || "").trim();
    if (!clean) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }

  return out;
}

function combineText(values) {
  return uniqueNonEmpty(values).join("\n\n");
}

function buildDerivedEntry(entry) {
  const pages = Array.isArray(entry.pages) ? entry.pages : [];

  return {
    ...entry,
    pages,
    pageCount: pages.length,
    title: firstNonEmpty(pages.map((p) => p.title)),
    scripture: firstNonEmpty(pages.map((p) => p.scripture)),
    scriptureText: combineText(pages.map((p) => p.scriptureText)),
    bodyText: combineText(pages.map((p) => p.bodyText || p.wordOfDay)),
    prayer: combineText(pages.map((p) => p.prayer))
  };
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeStoredEntries(raw) {
  const out = {};

  for (const [key, entry] of Object.entries(raw || {})) {
    const monthNumber = Number(entry.monthNumber || normalizeMonthNumber(entry));
    const day = Number(entry.day);

    if (!monthNumber || !day) continue;

    out[key] = {
      id: entry.id || key,
      key,
      day,
      monthNumber,
      month: entry.month || monthNameFromNumber(monthNumber),
      date: entry.date || formatMonthDay(monthNumber, day),
      pages: Array.isArray(entry.pages) ? entry.pages : []
    };
  }

  return out;
}

export default function Siku365() {
  const [entries, setEntries] = useState({});
  const [readDays, setReadDays] = useState(new Set());
  const [view, setView] = useState("today");
  const [selectedKey, setSelectedKey] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const [notifGranted, setNotifGranted] = useState(false);
  const [toast, setToast] = useState(null);
  const [currentUploadKey, setCurrentUploadKey] = useState("");
  const [previewImage, setPreviewImage] = useState(null);   // { dataUrl, rotation }
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  const todayMonthNumber = today.getMonth() + 1;
  const todayDateNumber = today.getDate();
  const todayKey = makeEntryKey(todayMonthNumber, todayDateNumber);

  useEffect(() => {
    const merged = normalizeStoredEntries(PRELOADED);

    const saved = safeJsonParse(localStorage.getItem(STORAGE_KEY) || "{}", {});
    const normalizedSaved = normalizeStoredEntries(saved);

    const finalEntries = { ...merged, ...normalizedSaved };
    setEntries(finalEntries);

    if (finalEntries[todayKey]) {
      setSelectedKey(todayKey);
    } else {
      const firstKey = Object.keys(finalEntries)[0] || "";
      setSelectedKey(firstKey);
    }

    const savedRead = safeJsonParse(localStorage.getItem(READ_KEY) || "[]", []);
    setReadDays(new Set(savedRead));

    if ("Notification" in window && Notification.permission === "granted") {
      setNotifGranted(true);
    }
  }, [todayKey]);

  const derivedEntries = useMemo(() => {
    return Object.values(entries)
      .map(buildDerivedEntry)
      .sort((a, b) => a.monthNumber - b.monthNumber || a.day - b.day);
  }, [entries]);

  const derivedEntriesByKey = useMemo(() => {
    const map = {};
    for (const entry of derivedEntries) {
      map[entry.key] = entry;
    }
    return map;
  }, [derivedEntries]);

  const todayEntry = derivedEntriesByKey[todayKey] || null;
  const selectedEntry = selectedKey ? derivedEntriesByKey[selectedKey] || null : null;

  const marchUploaded = derivedEntries.filter((e) => e.monthNumber === 3).length;

  const searchResults =
    searchQuery.trim().length >= 2
      ? derivedEntries.filter((e) =>
          [
            e.date,
            e.month,
            String(e.day),
            e.title,
            e.scripture,
            e.scriptureText,
            e.bodyText,
            e.prayer
          ].some((f) => String(f || "").toLowerCase().includes(searchQuery.toLowerCase()))
        )
      : [];

  function saveEntries(updated) {
    setEntries(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  function markRead(entryKey) {
    const next = new Set(readDays);
    next.add(entryKey);
    setReadDays(next);
    localStorage.setItem(READ_KEY, JSON.stringify([...next]));
    showToast("Imewekwa kama imesomwa ✓");
  }

  async function requestNotification() {
    if (!("Notification" in window)) return;

    const p = await Notification.requestPermission();
    if (p === "granted") {
      setNotifGranted(true);
      new Notification("Siku 365 za Ushindi 🙏", {
        body: "Ukumbusho wa Neno la Leo umewashwa!"
      });
      showToast("Ukumbusho umewashwa! ✓");
    }
  }

  function resetUploadDay() {
    setCurrentUploadKey("");
    setUploadResult(null);
    showToast("Sasa upload inayofuata itaanza siku mpya.");
  }

  function cancelPreview() {
    if (previewImage?.objectUrl) URL.revokeObjectURL(previewImage.objectUrl);
    setPreviewImage(null);
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  function openGallery() {
    if (!uploading) fileRef.current?.click();
  }
  function openCamera() {
    if (!uploading) cameraRef.current?.click();
  }

  // Read EXIF orientation tag from file bytes
  async function getExifRotation(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const view = new DataView(e.target.result);
        if (view.getUint16(0, false) !== 0xFFD8) return resolve(0);
        let offset = 2;
        while (offset < view.byteLength) {
          const marker = view.getUint16(offset, false);
          offset += 2;
          if (marker === 0xFFE1) {
            if (view.getUint32(offset + 2, false) !== 0x45786966) return resolve(0);
            const little = view.getUint16(offset + 8, false) === 0x4949;
            const tags = view.getUint16(offset + 14, little);
            for (let i = 0; i < tags; i++) {
              if (view.getUint16(offset + 16 + i * 12, little) === 0x0112) {
                const o = view.getUint16(offset + 16 + i * 12 + 8, little);
                const deg = o === 3 ? 180 : o === 6 ? 90 : o === 8 ? 270 : 0;
                return resolve(deg);
              }
            }
            return resolve(0);
          }
          if ((marker & 0xFF00) !== 0xFF00) break;
          offset += view.getUint16(offset, false);
        }
        resolve(0);
      };
      reader.readAsArrayBuffer(file.slice(0, 65536));
    });
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError("");
    setUploadResult(null);

    // Step 1: show preview with auto-detected rotation
    const exifDeg = await getExifRotation(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewImage({ objectUrl, rotation: exifDeg, file });
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  function rotatePreview(delta) {
    setPreviewImage(prev => prev ? { ...prev, rotation: (prev.rotation + delta + 360) % 360 } : prev);
  }

  async function confirmUpload() {
    if (!previewImage) return;
    const { objectUrl, rotation, file } = previewImage;
    setPreviewImage(null);
    setUploading(true);
    setUploadError("");

    try {
      const base64 = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          const rad = (rotation * Math.PI) / 180;
          const sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
          const MAX = 1200;
          let sw = img.width, sh = img.height;
          // canvas dimensions after rotation
          const cw = Math.round(sw * cos + sh * sin);
          const ch = Math.round(sw * sin + sh * cos);
          // scale down if needed
          const scale = Math.min(1, MAX / Math.max(cw, ch));
          const fw = Math.round(cw * scale), fh = Math.round(ch * scale);
          const canvas = document.createElement("canvas");
          canvas.width = fw; canvas.height = fh;
          const ctx = canvas.getContext("2d");
          ctx.translate(fw / 2, fh / 2);
          ctx.rotate(rad);
          ctx.drawImage(img, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale);
          resolve(canvas.toDataURL("image/jpeg", 0.82).split(",")[1]);
        };
        img.onerror = reject;
        img.src = objectUrl;
      });

      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64,
          fileType: file.type || "image/jpeg"
        })
      });

      const raw = await resp.text();
      const data = safeJsonParse(raw, null);

      if (!resp.ok) {
        if (data?.error) throw new Error(data.error);
        throw new Error(raw.slice(0, 160) || "Request failed");
      }

      if (!data) {
        throw new Error("Majibu ya server hayakuwa JSON sahihi");
      }

      const text = Array.isArray(data.content)
        ? data.content.map((b) => b.text || "").join("")
        : "";

      const parsed = safeJsonParse(text.replace(/```json|```/g, "").trim(), null);

      if (!parsed) {
        throw new Error("Claude hakurudisha JSON sahihi");
      }

      let key = currentUploadKey;
      let existing = key ? entries[key] : null;

      if (!existing) {
        const day = Number(parsed.day);
        const monthNumber = Number(parsed.monthNumber || normalizeMonthNumber(parsed));
        const month = parsed.month || monthNameFromNumber(monthNumber);

        if (!day || !monthNumber) {
          throw new Error("Tarehe haikupatikana. Pakia ukurasa wa kwanza wenye tarehe juu.");
        }

        key = makeEntryKey(monthNumber, day);
        existing = entries[key] || null;

        if (!existing) {
          existing = {
            id: key,
            key,
            day,
            monthNumber,
            month,
            date: parsed.date || formatMonthDay(monthNumber, day),
            pages: []
          };
        }
      }

      const newPage = {
        id: `page-${Date.now()}`,
        title: parsed.title || "",
        scripture: parsed.scripture || "",
        scriptureText: parsed.scriptureText || "",
        bodyText: parsed.bodyText || parsed.wordOfDay || "",
        prayer: parsed.prayer || "",
        uploadedAt: new Date().toISOString()
      };

      const updatedEntry = {
        ...existing,
        pages: [...(existing.pages || []), newPage]
      };

      const updatedEntries = {
        ...entries,
        [key]: updatedEntry
      };

      saveEntries(updatedEntries);
      setCurrentUploadKey(key);
      setSelectedKey(key);
      setUploadResult(buildDerivedEntry(updatedEntry));

      if (existing.pages?.length) {
        showToast(`Ukurasa mwingine umeongezwa kwenye ${updatedEntry.date} ✓`);
      } else {
        showToast(`${updatedEntry.date} imehifadhiwa ✓`);
      }
    } catch (err) {
      setUploadError("Hitilafu: " + (err?.message || "Jaribu tena"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function deletePage(entryKey, pageId) {
    const entry = entries[entryKey];
    if (!entry) return;

    const remainingPages = (entry.pages || []).filter((p) => p.id !== pageId);

    if (remainingPages.length === 0) {
      deleteEntry(entryKey);
      return;
    }

    const updatedEntries = {
      ...entries,
      [entryKey]: {
        ...entry,
        pages: remainingPages
      }
    };

    saveEntries(updatedEntries);

    if (currentUploadKey === entryKey) {
      setUploadResult(buildDerivedEntry(updatedEntries[entryKey]));
    }

    showToast("Upload hiyo imefutwa ✓");
  }

  function deleteEntry(entryKey) {
    const entry = derivedEntriesByKey[entryKey];
    if (!entry) return;

    const ok = window.confirm(`Unataka kufuta kabisa ${entry.date}?`);
    if (!ok) return;

    const updatedEntries = { ...entries };
    delete updatedEntries[entryKey];
    saveEntries(updatedEntries);

    const nextRead = new Set(readDays);
    nextRead.delete(entryKey);
    setReadDays(nextRead);
    localStorage.setItem(READ_KEY, JSON.stringify([...nextRead]));

    if (selectedKey === entryKey) {
      const remainingKeys = Object.keys(updatedEntries);
      setSelectedKey(remainingKeys[0] || "");
    }

    if (currentUploadKey === entryKey) {
      setCurrentUploadKey("");
      setUploadResult(null);
    }

    showToast("Siku imefutwa ✓");
  }

  function shareWhatsApp(entry) {
    const text = `📖 *${entry.date} — ${entry.title || ""}*

${entry.bodyText || ""}

📜 *${entry.scripture || ""}:*
"${entry.scriptureText || ""}"

🙏 *Sala:*
${entry.prayer || ""}

_Siku 365 za Ushindi 2026 · Pastor Tony Osborn_`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f0e8", fontFamily: "'Georgia', serif", color: "#1a2e1a" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Lato:wght@300;400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        .app-header{background:linear-gradient(135deg,#1a3d1a,#0f2610);color:#f5f0e8;position:sticky;top:0;z-index:100;box-shadow:0 4px 20px rgba(0,0,0,.3)}
        .header-top{padding:16px 20px 12px;display:flex;align-items:center;justify-content:space-between}
        .header-title{font-family:'Playfair Display',serif;font-size:21px;font-weight:900;color:#d4af37}
        .header-sub{font-family:'Lato',sans-serif;font-size:10px;color:rgba(245,240,232,.55);letter-spacing:2px;text-transform:uppercase;margin-top:2px}
        .day-badge{background:#d4af37;color:#1a3d1a;font-family:'Playfair Display',serif;font-weight:700;font-size:13px;padding:6px 14px;border-radius:20px;white-space:nowrap}
        .nav-tabs{display:flex;border-top:1px solid rgba(255,255,255,.1)}
        .nav-tab{flex:1;padding:10px 4px;text-align:center;font-family:'Lato',sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:rgba(245,240,232,.45);cursor:pointer;border:none;background:transparent;border-bottom:2px solid transparent;transition:all .2s}
        .nav-tab.active{color:#d4af37;border-bottom-color:#d4af37}
        .main-content{max-width:680px;margin:0 auto;padding:20px 16px 80px}
        .summary-card{background:linear-gradient(135deg,#1a3d1a,#2d5a2d);border-radius:16px;color:#f5f0e8;padding:20px 24px;margin-bottom:20px;box-shadow:0 6px 24px rgba(26,46,26,.2)}
        .summary-label{font-family:'Lato',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#d4af37;margin-bottom:6px}
        .summary-title{font-family:'Playfair Display',serif;font-size:20px;font-weight:700;margin-bottom:12px}
        .summary-stats{font-family:'Lato',sans-serif;font-size:12px;color:rgba(245,240,232,.8);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
        .entry-card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(26,46,26,.12);margin-bottom:20px}
        .entry-header{background:linear-gradient(135deg,#1a3d1a,#2d5a2d);color:#f5f0e8;padding:24px 24px 20px;position:relative;overflow:hidden}
        .entry-day-bg{font-family:'Playfair Display',serif;font-size:70px;font-weight:900;line-height:1;color:rgba(212,175,55,.18);position:absolute;right:12px;top:8px;pointer-events:none}
        .entry-day-label{font-family:'Lato',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#d4af37;margin-bottom:8px}
        .entry-title{font-family:'Playfair Display',serif;font-size:22px;font-weight:700;line-height:1.25;max-width:320px}
        .section{padding:18px 24px;border-bottom:1px solid #f0ebe0}
        .section:last-child{border-bottom:none}
        .sec-label{font-family:'Lato',sans-serif;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#2d5a2d;margin-bottom:10px;display:flex;align-items:center;gap:8px}
        .sec-label::after{content:'';flex:1;height:1px;background:#d4af37;opacity:.35}
        .scripture-ref{font-family:'Lato',sans-serif;font-size:11px;font-weight:700;color:#d4af37;background:#1a3d1a;display:inline-block;padding:3px 10px;border-radius:12px;margin-bottom:10px}
        .scripture-text{font-family:'Playfair Display',serif;font-style:italic;font-size:16px;line-height:1.65;border-left:3px solid #d4af37;padding-left:14px}
        .word-text{font-family:'Lato',sans-serif;font-size:15px;line-height:1.8;color:#2a3e2a}
        .prayer-text{font-family:'Georgia',serif;font-size:15px;line-height:1.9;color:#1a2e1a;background:#f8f5ee;padding:16px;border-radius:8px;border-left:3px solid #2d5a2d;white-space:pre-line}
        .action-row{padding:16px 24px;display:flex;gap:10px;flex-wrap:wrap;background:#fafaf7}
        .btn{font-family:'Lato',sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:10px 18px;border-radius:8px;border:none;cursor:pointer;transition:all .2s}
        .btn-primary{background:#1a3d1a;color:#f5f0e8}
        .btn-outline{background:transparent;border:1.5px solid #1a3d1a;color:#1a3d1a}
        .btn-wa{background:#25D366;color:#fff}
        .btn-read{background:#e8f5e8;color:#2d5a2d;border:1.5px solid #2d5a2d}
        .btn-danger{background:#b42318;color:#fff}
        .btn-soft{background:#f0ebe0;color:#1a2e1a}
        .stats-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
        .stat-card{background:#fff;border-radius:12px;padding:14px 10px;text-align:center;box-shadow:0 2px 12px rgba(26,46,26,.07)}
        .stat-number{font-family:'Playfair Display',serif;font-size:30px;font-weight:900;color:#1a3d1a;line-height:1}
        .stat-label{font-family:'Lato',sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#8a7a5a;margin-top:4px}
        .empty-day{background:#fff;border-radius:16px;padding:44px 28px;text-align:center;box-shadow:0 6px 30px rgba(26,46,26,.08)}
        .empty-icon{font-size:44px;margin-bottom:14px}
        .empty-title{font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:#1a3d1a;margin-bottom:8px}
        .empty-text{font-family:'Lato',sans-serif;font-size:13px;color:#8a7a5a;line-height:1.6;margin-bottom:20px}
        .upload-zone{background:#fff;border-radius:16px;padding:40px 24px;text-align:center;border:2px dashed #c8b896;box-shadow:0 4px 20px rgba(26,46,26,.06);margin-bottom:16px;cursor:pointer}
        .upload-title{font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:#1a3d1a;margin-bottom:6px}
        .upload-sub{font-family:'Lato',sans-serif;font-size:13px;color:#8a7a5a;line-height:1.5}
        .spinner{display:inline-block;width:22px;height:22px;border:2px solid rgba(212,175,55,.3);border-top-color:#d4af37;border-radius:50%;animation:spin .8s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        .search-box{background:#fff;border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;box-shadow:0 2px 12px rgba(26,46,26,.08);margin-bottom:16px}
        .search-input{flex:1;border:none;outline:none;font-family:'Lato',sans-serif;font-size:15px;color:#1a2e1a;background:transparent}
        .src-card{background:#fff;border-radius:12px;padding:16px;margin-bottom:10px;cursor:pointer;box-shadow:0 2px 10px rgba(26,46,26,.06);border-left:3px solid transparent}
        .src-card:hover{border-left-color:#d4af37}
        .notif-banner{background:linear-gradient(135deg,#2d5a2d,#1a3d1a);color:#f5f0e8;border-radius:12px;padding:14px 18px;display:flex;align-items:center;gap:12px;margin-bottom:20px;cursor:pointer}
        .sec-title{font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:#1a3d1a;margin-bottom:16px}
        .result-preview{background:#f0f8f0;border-radius:12px;padding:16px;border-left:4px solid #2d5a2d;margin-top:16px}
        .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a3d1a;color:#d4af37;font-family:'Lato',sans-serif;font-size:13px;font-weight:700;padding:12px 24px;border-radius:24px;box-shadow:0 8px 24px rgba(0,0,0,.3);z-index:999}
        .page-list{display:grid;gap:10px}
        .page-item{background:#faf8f2;border:1px solid #ece4d4;border-radius:10px;padding:12px}
        .tiny{font-family:'Lato',sans-serif;font-size:11px;color:#8a7a5a}
      `}</style>

      <div className="app-header">
        <div className="header-top">
          <div>
            <div className="header-title">Siku 365 za Ushindi</div>
            <div className="header-sub">Pastor Tony Osborn · 2026</div>
          </div>
          <div className="day-badge">
            {today.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
        </div>

        <div className="nav-tabs">
          {[
            { id: "today", label: "Leo" },
            { id: "browse", label: "Zote" },
            { id: "search", label: "Tafuta" },
            { id: "upload", label: "📷 Pakia" }
          ].map((tab) => (
            <button
              key={tab.id}
              className={`nav-tab${view === tab.id ? " active" : ""}`}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="main-content">
        {view === "today" && (
          <>
            {!notifGranted && (
              <div className="notif-banner" onClick={requestNotification}>
                <span style={{ fontSize: 26 }}>🔔</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
                    Washa Ukumbusho wa Kila Siku
                  </div>
                  <div style={{ fontFamily: "'Lato',sans-serif", fontSize: 11, opacity: 0.7 }}>
                    Bonyeza hapa kupata taarifa ya Neno la Leo
                  </div>
                </div>
              </div>
            )}

            <div className="summary-card">
              <div className="summary-label">Muhtasari</div>
              <div className="summary-title">Muongozo wa Maombi 2026</div>
              <div className="summary-stats">
                <span>Siku zote: {derivedEntries.length}</span>
                <span>Machi: {marchUploaded}</span>
                <span>Zilizosomwa: {readDays.size}</span>
              </div>
            </div>

            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-number">{derivedEntries.length}</div>
                <div className="stat-label">Siku Zote</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{marchUploaded}</div>
                <div className="stat-label">Machi</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{todayEntry?.pageCount || 0}</div>
                <div className="stat-label">Kurasa za Leo</div>
              </div>
            </div>

            {todayEntry ? (
              <EntryCard
                entry={todayEntry}
                isRead={readDays.has(todayKey)}
                isToday
                onMarkRead={() => markRead(todayKey)}
                onShare={shareWhatsApp}
                onDeletePage={(pageId) => deletePage(todayKey, pageId)}
                onDeleteEntry={() => deleteEntry(todayKey)}
              />
            ) : (
              <div className="empty-day">
                <div className="empty-icon">📖</div>
                <div className="empty-title">
                  {today.toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                </div>
                <div className="empty-text">Bado hujaweka devotional ya leo.</div>
                <button className="btn btn-primary" onClick={() => setView("upload")}>
                  📷 Pakia Siku ya Leo
                </button>
              </div>
            )}
          </>
        )}

        {view === "browse" && (
          <>
            <div className="sec-title">Siku Zilizohifadhiwa</div>

            {derivedEntries.length === 0 ? (
              <div className="empty-day">
                <div className="empty-icon">📄</div>
                <div className="empty-title">Hakuna entries bado</div>
              </div>
            ) : (
              <>
                {derivedEntries.map((entry) => (
                  <div
                    key={entry.key}
                    className="src-card"
                    onClick={() => setSelectedKey(entry.key)}
                  >
                    <div style={{ fontFamily: "'Lato',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#d4af37", marginBottom: 4 }}>
                      {entry.date} · kurasa {entry.pageCount}
                    </div>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 700, color: "#1a3d1a" }}>
                      {entry.title || "(Bila kichwa)"}
                    </div>
                  </div>
                ))}

                {selectedEntry && (
                  <EntryCard
                    entry={selectedEntry}
                    isRead={readDays.has(selectedEntry.key)}
                    isToday={selectedEntry.key === todayKey}
                    onMarkRead={() => markRead(selectedEntry.key)}
                    onShare={shareWhatsApp}
                    onDeletePage={(pageId) => deletePage(selectedEntry.key, pageId)}
                    onDeleteEntry={() => deleteEntry(selectedEntry.key)}
                  />
                )}
              </>
            )}
          </>
        )}

        {view === "search" && (
          <>
            <div className="sec-title">Tafuta</div>

            <div className="search-box">
              <span style={{ fontSize: 18 }}>🔍</span>
              <input
                className="search-input"
                placeholder="Tafuta kwa neno, tarehe, mwezi, maandiko..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              {searchQuery && (
                <button
                  style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#aaa" }}
                  onClick={() => setSearchQuery("")}
                >
                  ✕
                </button>
              )}
            </div>

            {searchQuery.trim().length < 2 ? (
              <div style={{ textAlign: "center", padding: "32px 0", fontFamily: "'Lato',sans-serif", color: "#aaa", fontSize: 14 }}>
                Andika angalau herufi 2 kutafuta...
              </div>
            ) : searchResults.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", fontFamily: "'Lato',sans-serif", color: "#aaa", fontSize: 14 }}>
                Hakuna matokeo.
              </div>
            ) : (
              searchResults.map((entry) => (
                <div
                  key={entry.key}
                  className="src-card"
                  onClick={() => {
                    setSelectedKey(entry.key);
                    setView("browse");
                  }}
                >
                  <div style={{ fontFamily: "'Lato',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#d4af37", marginBottom: 4 }}>
                    {entry.date}
                  </div>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 700, color: "#1a3d1a" }}>
                    {entry.title || "(Bila kichwa)"}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {view === "upload" && (
          <>
            <div className="sec-title">Pakia Ukurasa</div>

            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleUpload} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleUpload} />

            {currentUploadKey && derivedEntriesByKey[currentUploadKey] && (
              <div className="result-preview" style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 700, color: "#1a3d1a", marginBottom: 6 }}>
                  Unaongeza kurasa kwenye {derivedEntriesByKey[currentUploadKey].date}
                </div>
                <div className="tiny" style={{ marginBottom: 12 }}>
                  Hii inasaidia kwa ukurasa wa pili au wa tatu ambao hauna tarehe juu.
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn btn-soft" onClick={resetUploadDay}>
                    Anza Siku Mpya
                  </button>
                  <button className="btn btn-primary" onClick={openCamera}>📷 Piga Picha</button>
                  <button className="btn btn-outline" onClick={openGallery}>🖼️ Gallery</button>
                </div>
              </div>
            )}

            {previewImage ? (
              <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 8px 32px rgba(26,46,26,0.15)", marginBottom: 16 }}>
                <div style={{ background: "#1a3d1a", padding: "12px 16px", fontFamily: "'Lato',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#d4af37" }}>
                  Kagua Picha — Rekebisha kama ni lazima
                </div>
                <div style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                  <div style={{ width: "100%", maxHeight: 340, overflow: "hidden", borderRadius: 10, background: "#f0ebe0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <img
                      src={previewImage.objectUrl}
                      alt="Preview"
                      style={{
                        maxWidth: "100%", maxHeight: 340,
                        transform: `rotate(${previewImage.rotation}deg)`,
                        transition: "transform 0.3s ease",
                        objectFit: "contain"
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 10, width: "100%" }}>
                    <button onClick={() => rotatePreview(-90)} style={{ flex: 1, padding: "12px", borderRadius: 10, background: "#f0ebe0", border: "none", cursor: "pointer", fontFamily: "'Lato',sans-serif", fontSize: 14, fontWeight: 700, color: "#1a2e1a" }}>
                      ↺ Kushoto
                    </button>
                    <button onClick={() => rotatePreview(90)} style={{ flex: 1, padding: "12px", borderRadius: 10, background: "#f0ebe0", border: "none", cursor: "pointer", fontFamily: "'Lato',sans-serif", fontSize: 14, fontWeight: 700, color: "#1a2e1a" }}>
                      Kulia ↻
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 10, width: "100%" }}>
                    <button onClick={cancelPreview} style={{ flex: 1, padding: "14px", borderRadius: 10, background: "transparent", border: "1.5px solid #1a3d1a", cursor: "pointer", fontFamily: "'Lato',sans-serif", fontSize: 14, fontWeight: 700, color: "#1a3d1a" }}>
                      Ghairi
                    </button>
                    <button onClick={confirmUpload} style={{ flex: 2, padding: "14px", borderRadius: 10, background: "linear-gradient(135deg,#1a3d1a,#2d5a2d)", border: "none", cursor: "pointer", fontFamily: "'Lato',sans-serif", fontSize: 14, fontWeight: 700, color: "#f5f0e8" }}>
                      ✓ Tuma kwa AI
                    </button>
                  </div>
                </div>
              </div>
            ) : uploading ? (
              <div className="upload-zone">
                <div style={{ marginBottom: 12 }}><span className="spinner" /></div>
                <div className="upload-title">AI inasoma ukurasa...</div>
                <div className="upload-sub">Tafadhali subiri kidogo</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
                <button
                  onClick={openCamera}
                  style={{
                    width: "100%", padding: "18px", borderRadius: 14,
                    background: "linear-gradient(135deg,#1a3d1a,#2d5a2d)",
                    color: "#f5f0e8", border: "none", cursor: "pointer",
                    fontFamily: "'Lato',sans-serif", fontSize: 16, fontWeight: 700,
                    letterSpacing: 1, display: "flex", alignItems: "center",
                    justifyContent: "center", gap: 10,
                    boxShadow: "0 4px 16px rgba(26,46,26,0.25)"
                  }}
                >
                  <span style={{ fontSize: 24 }}>📷</span> Piga Picha
                </button>
                <button
                  onClick={openGallery}
                  style={{
                    width: "100%", padding: "18px", borderRadius: 14,
                    background: "#fff", color: "#1a3d1a",
                    border: "2px solid #1a3d1a", cursor: "pointer",
                    fontFamily: "'Lato',sans-serif", fontSize: 16, fontWeight: 700,
                    letterSpacing: 1, display: "flex", alignItems: "center",
                    justifyContent: "center", gap: 10,
                    boxShadow: "0 2px 10px rgba(26,46,26,0.1)"
                  }}
                >
                  <span style={{ fontSize: 24 }}>🖼️</span> Chagua kutoka Gallery
                </button>
                <div style={{ fontFamily: "'Lato',sans-serif", fontSize: 12, color: "#8a7a5a", textAlign: "center", lineHeight: 1.5 }}>
                  {currentUploadKey ? "Ukurasa utaongezwa kwenye siku ile ile." : "Kwa ukurasa wa kwanza, hakikisha tarehe inaonekana."}
                </div>
              </div>
            )}

            {uploadError && (
              <div style={{ background: "#fff0f0", border: "1px solid #ffaaaa", borderRadius: 10, padding: "14px 16px", fontFamily: "'Lato',sans-serif", fontSize: 13, color: "#c0392b", marginBottom: 12 }}>
                ⚠️ {uploadError}
              </div>
            )}

            {uploadResult && (
              <div className="result-preview">
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 700, color: "#1a3d1a", marginBottom: 6 }}>
                  ✅ {uploadResult.date} — {uploadResult.title || "(Bila kichwa)"}
                </div>
                <div style={{ fontFamily: "'Lato',sans-serif", fontSize: 13, color: "#5a4a2a", lineHeight: 1.6 }}>
                  📜 {uploadResult.scripture || "Hakuna reference"}<br />
                  📄 Kurasa {uploadResult.pageCount}
                </div>
                <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={openCamera}>📷 Piga Picha</button>
                  <button className="btn btn-outline" style={{ fontSize: 11 }} onClick={openGallery}>🖼️ Gallery</button>
                  <button className="btn btn-outline" style={{ fontSize: 11 }} onClick={resetUploadDay}>
                    Siku Mpya
                  </button>
                  <button className="btn btn-outline" style={{ fontSize: 11 }} onClick={() => { setSelectedKey(uploadResult.key); setView("browse"); }}>
                    Angalia Entry
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function EntryCard({ entry, isRead, isToday, onMarkRead, onShare, onDeletePage, onDeleteEntry }) {
  return (
    <div className="entry-card">
      <div className="entry-header">
        <div className="entry-day-bg">{entry.day}</div>
        <div className="entry-day-label">
          {isToday ? "✨ Leo" : entry.date} · kurasa {entry.pageCount}
        </div>
        <div className="entry-title">{entry.title || "(Bila kichwa)"}</div>
      </div>

      {entry.scriptureText && (
        <div className="section">
          <div className="sec-label">Maandiko</div>
          <div className="scripture-ref">{entry.scripture || "Reference"}</div>
          <div className="scripture-text">{entry.scriptureText}</div>
        </div>
      )}

      {entry.bodyText && (
        <div className="section">
          <div className="word-text">{entry.bodyText}</div>
        </div>
      )}

      {entry.prayer && (
        <div className="section">
          <div className="sec-label">Sala</div>
          <div className="prayer-text">{entry.prayer}</div>
        </div>
      )}

      {!!entry.pages?.length && (
        <div className="section">
          <div className="sec-label">Uploads za Siku Hii</div>
          <div className="page-list">
            {entry.pages.map((page, idx) => (
              <div key={page.id} className="page-item">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, color: "#1a3d1a" }}>
                      Ukurasa {idx + 1}
                    </div>
                    <div className="tiny">
                      {page.uploadedAt ? new Date(page.uploadedAt).toLocaleString() : ""}
                    </div>
                  </div>
                  <button className="btn btn-danger" style={{ fontSize: 10, padding: "8px 10px" }} onClick={() => onDeletePage(page.id)}>
                    Futa Upload
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="action-row">
        {!isRead ? (
          <button className="btn btn-read" onClick={onMarkRead}>
            ✓ Imesomwa
          </button>
        ) : (
          <span style={{ fontFamily: "'Lato',sans-serif", fontSize: 11, fontWeight: 700, color: "#2d5a2d", display: "flex", alignItems: "center", gap: 4 }}>
            ✅ Imesomwa
          </span>
        )}

        <button className="btn btn-wa" onClick={() => onShare(entry)}>
          📤 WhatsApp
        </button>

        <button className="btn btn-danger" onClick={onDeleteEntry}>
          🗑️ Futa Siku
        </button>
      </div>
    </div>
  );
}
