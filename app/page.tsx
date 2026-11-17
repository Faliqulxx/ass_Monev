"use client";

import React, { useState, useEffect, useRef } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function getLS(key: string, defaultVal: string): string {
  if (typeof window === "undefined") return defaultVal;
  try {
    const v = localStorage.getItem(key);
    return v === null ? defaultVal : v;
  } catch {
    return defaultVal;
  }
}

function setLS(key: string, val: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, val);
  } catch {
    // ignore storage errors
  }
}

function clampLen(v: string | number): number {
  const n = typeof v === "number" ? v : parseInt(v, 10);
  if (isNaN(n) || n <= 0) return 100;
  return Math.max(50, Math.min(1000, n));
}

export default function HomePage() {
  const [today, setToday] = useState<string>("");

  // Single unified input description
  const [deskripsi, setDeskripsi] = useState<string>("");

  // 3 Output columns filled automatically from the description
  const [uraian, setUraian] = useState<string>("");
  const [pembelajaran, setPembelajaran] = useState<string>("");
  const [outKendala, setOutKendala] = useState<string>("");

  // Target character length (typed only, default 100)
  const [maxLen, setMaxLen] = useState<number>(100);
  const [maxInput, setMaxInput] = useState<string>("100");

  // Settings
  const [apiKey, setApiKey] = useState<string>("");
  const [showKey, setShowKey] = useState<boolean>(false);
  const [model, setModel] = useState<string>("gemini-2.5-flash");
  const [style, setStyle] = useState<string>("first");

  // PWA Install states
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(true);
  const [isIOS, setIsIOS] = useState<boolean>(false);

  // UI states
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string>("");
  const [toastMsg, setToastMsg] = useState<string>("");
  const [toastVisible, setToastVisible] = useState<boolean>(false);

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const iosDialogRef = useRef<HTMLDialogElement | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    );

    // Load saved drafts & settings from localStorage
    setDeskripsi(getLS("draft_in-deskripsi", ""));
    setUraian(getLS("draft_out-uraian", ""));
    setPembelajaran(getLS("draft_out-pembelajaran", ""));
    setOutKendala(getLS("draft_out-kendala", ""));

    const savedMax = clampLen(getLS("target_len", "100"));
    setMaxLen(savedMax);
    setMaxInput(String(savedMax));

    setApiKey(getLS("gemini_key", ""));
    setModel(getLS("gemini_model", "gemini-2.5-flash"));
    setStyle(getLS("style", "first"));

    // Check standalone / iOS status
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
    setIsStandalone(standalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    // Listen for Android/Chrome PWA install prompt
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    // Register Service Worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
    }, 1800);
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setDeferredPrompt(null);
      }
    } else if (isIOS) {
      iosDialogRef.current?.showModal();
    }
  };

  const handleSetMax = (val: string | number) => {
    const m = clampLen(val);
    setMaxLen(m);
    setMaxInput(String(m));
    setLS("target_len", String(m));
  };

  const copyText = async (text: string, id: string) => {
    if (!text.trim()) {
      showToast("Belum ada teks untuk disalin");
      return;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("Copy failed");
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(""), 1600);
      showToast("Berhasil disalin ke clipboard");
    } catch {
      showToast("Gagal menyalin teks");
    }
  };

  const getCountInfo = (text: string) => {
    const n = text.trim().length;
    const min = maxLen <= 100 ? maxLen : 100;
    const max = maxLen <= 100 ? maxLen + 25 : maxLen;
    const pct = Math.min(100, Math.round((n / max) * 100));

    if (n === 0) {
      return {
        txt: `0 / ${maxLen} karakter`,
        cls: "",
        pct: 0,
      };
    }
    let txt = `${n} karakter`;
    let cls = "ok";
    if (n < min) {
      cls = "bad";
      txt += ` (kurang ${min - n})`;
    } else if (n > max) {
      cls = "warn";
      txt += ` (+${n - max} lewat batas)`;
    } else {
      txt += " • Pas";
    }
    return { txt, cls, pct };
  };

  const handleSaveSettings = () => {
    const trimmedKey = apiKey.trim();
    const trimmedModel = model.trim() || "gemini-2.5-flash";
    setApiKey(trimmedKey);
    setModel(trimmedModel);
    setLS("gemini_key", trimmedKey);
    setLS("gemini_model", trimmedModel);
    setLS("style", style);
    dialogRef.current?.close();
    showToast("Pengaturan berhasil disimpan");
  };

  const handleClearAll = () => {
    setDeskripsi("");
    setUraian("");
    setPembelajaran("");
    setOutKendala("");
    setLS("draft_in-deskripsi", "");
    setLS("draft_out-uraian", "");
    setLS("draft_out-pembelajaran", "");
    setLS("draft_out-kendala", "");
    setError("");
    showToast("Catatan & hasil dibersihkan");
  };

  const generate = async () => {
    const d = deskripsi.trim();

    if (!d) {
      setError("Isi dulu deskripsi singkat kegiatan hari ini.");
      return;
    }

    const currentLen = clampLen(maxInput);
    handleSetMax(currentLen);

    setError("");
    setBusy(true);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deskripsi: d,
          style,
          maxLen: currentLen,
          apiKey,
          model,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const nextUraian = (data.uraian || "").trim();
      const nextPembelajaran = (data.pembelajaran || "").trim();
      const nextKendala = (data.kendala || "").trim();

      setUraian(nextUraian);
      setPembelajaran(nextPembelajaran);
      setOutKendala(nextKendala);

      setLS("draft_out-uraian", nextUraian);
      setLS("draft_out-pembelajaran", nextPembelajaran);
      setLS("draft_out-kendala", nextKendala);

      showToast("3 kolom laporan berhasil dibuat");
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 60);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const uraianCount = getCountInfo(uraian);
  const pembelajaranCount = getCountInfo(pembelajaran);
  const kendalaCount = getCountInfo(outKendala);
  const canShowInstall = !isStandalone && (Boolean(deferredPrompt) || isIOS);

  return (
    <>
      <header>
        <div className="header-inner">
          <div className="brand">
            <div className="brand-icon" aria-hidden="true">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <div className="brand-text">
              <h1>Asisten Laporan Harian</h1>
              <span>Generator otomatis 3 kolom laporan magang</span>
            </div>
          </div>

          <div className="header-actions">
            {canShowInstall && (
              <button
                type="button"
                className="icon-btn install-btn"
                onClick={handleInstallClick}
                aria-label="Unduh Aplikasi ke HP"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Install</span>
              </button>
            )}

            <button
              className="icon-btn"
              onClick={() => dialogRef.current?.showModal()}
              aria-label="Pengaturan API & Model"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>Pengaturan</span>
            </button>
          </div>
        </div>
      </header>

      <main>
        <div className="top-meta">
          <div className="date-pill">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>{today || "Memuat tanggal..."}</span>
          </div>

          <button
            type="button"
            onClick={() => dialogRef.current?.showModal()}
            className={`key-badge ${apiKey.trim() ? "ready" : "missing"}`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {apiKey.trim() ? (
                <polyline points="20 6 9 17 4 12" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </>
              )}
            </svg>
            <span>
              {apiKey.trim()
                ? `Model: ${model || "gemini-2.5-flash"}`
                : "API Key belum diatur"}
            </span>
          </button>
        </div>

        {/* Kartu Input Utama */}
        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Ceritakan Kegiatan Hari Ini</h2>
              <p className="section-sub">
                Tulis singkat kegiatan, hasil yang didapat, dan kendala (jika
                ada) dalam satu kotak.
              </p>
            </div>
            {(deskripsi || uraian || pembelajaran || outKendala) && (
              <button
                type="button"
                className="btn ghost small"
                onClick={handleClearAll}
              >
                Bersihkan
              </button>
            )}
          </div>

          <div className="field">
            <textarea
              id="in-deskripsi"
              rows={4}
              value={deskripsi}
              onChange={(e) => {
                setDeskripsi(e.target.value);
                setLS("draft_in-deskripsi", e.target.value);
              }}
              placeholder="Contoh: Hari ini ikut rapat tim dan bantu rekap laporan bulanan pakai Excel pivot, hasilnya jadi paham alur pelaporan dan rumus pivot, kendalanya ada beberapa data cabang yang belum lengkap."
            />
          </div>

          <div className="controls-grid">
            <div className="control-item">
              <label htmlFor="in-max">Target Panjang Tiap Kolom</label>
              <div className="input-with-unit">
                <input
                  id="in-max"
                  type="number"
                  inputMode="numeric"
                  min={50}
                  max={1000}
                  step={1}
                  value={maxInput}
                  onChange={(e) => setMaxInput(e.target.value)}
                  onBlur={() => handleSetMax(maxInput)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSetMax(maxInput);
                  }}
                  placeholder="100"
                />
                <span className="input-unit">karakter</span>
              </div>
            </div>

            <div className="control-item">
              <label htmlFor="quick-style">Gaya Bahasa Laporan</label>
              <select
                id="quick-style"
                value={style}
                onChange={(e) => {
                  setStyle(e.target.value);
                  setLS("style", e.target.value);
                }}
              >
                <option value="first">
                  Orang pertama (&quot;Saya melakukan...&quot;)
                </option>
                <option value="none">
                  Tanpa subjek (&quot;Melakukan...&quot;)
                </option>
              </select>
            </div>
          </div>

          <button className="btn" onClick={generate} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" />
                <span>Merangkai 3 kolom laporan...</span>
              </>
            ) : (
              <>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span>Buat Laporan</span>
              </>
            )}
          </button>

          {error && <div className="error-banner">{error}</div>}
        </section>

        {/* Bagian 3 Kolom Hasil */}
        <section ref={resultsRef}>
          <div className="outputs-header">
            <h2>Hasil 3 Kolom Laporan</h2>
            <button
              type="button"
              className="btn ghost small"
              onClick={generate}
              disabled={busy || !deskripsi.trim()}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              <span>Buat Variasi Lain</span>
            </button>
          </div>

          {/* Kolom 1: Uraian Aktivitas */}
          <div className="output-card">
            <div className="res-title">
              <label htmlFor="out-uraian" className="col-label">
                <span className="col-num">1</span>
                <span>Kegiatan hari ini (Uraian aktivitas)</span>
              </label>
              <button
                type="button"
                className={`btn small copy-btn ${
                  copiedId === "uraian" ? "copied" : ""
                }`}
                onClick={() => copyText(uraian, "uraian")}
              >
                {copiedId === "uraian" ? (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Tersalin</span>
                  </>
                ) : (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>Salin</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              id="out-uraian"
              rows={3}
              value={uraian}
              onChange={(e) => {
                setUraian(e.target.value);
                setLS("draft_out-uraian", e.target.value);
              }}
              placeholder="Kolom uraian aktivitas akan terisi otomatis di sini..."
            />
            <div className="meta-bar">
              <div className="progress-track">
                <div
                  className={`progress-fill ${uraianCount.cls}`}
                  style={{ width: `${uraianCount.pct}%` }}
                />
              </div>
              <span className={`count-pill ${uraianCount.cls}`}>
                {uraianCount.txt}
              </span>
            </div>
          </div>

          {/* Kolom 2: Pembelajaran */}
          <div className="output-card">
            <div className="res-title">
              <label htmlFor="out-pembelajaran" className="col-label">
                <span className="col-num">2</span>
                <span>Hasil / pembelajaran yang diperoleh</span>
              </label>
              <button
                type="button"
                className={`btn small copy-btn ${
                  copiedId === "pembelajaran" ? "copied" : ""
                }`}
                onClick={() => copyText(pembelajaran, "pembelajaran")}
              >
                {copiedId === "pembelajaran" ? (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Tersalin</span>
                  </>
                ) : (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>Salin</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              id="out-pembelajaran"
              rows={3}
              value={pembelajaran}
              onChange={(e) => {
                setPembelajaran(e.target.value);
                setLS("draft_out-pembelajaran", e.target.value);
              }}
              placeholder="Kolom hasil/pembelajaran akan terisi otomatis di sini..."
            />
            <div className="meta-bar">
              <div className="progress-track">
                <div
                  className={`progress-fill ${pembelajaranCount.cls}`}
                  style={{ width: `${pembelajaranCount.pct}%` }}
                />
              </div>
              <span className={`count-pill ${pembelajaranCount.cls}`}>
                {pembelajaranCount.txt}
              </span>
            </div>
          </div>

          {/* Kolom 3: Kendala */}
          <div className="output-card">
            <div className="res-title">
              <label htmlFor="out-kendala" className="col-label">
                <span className="col-num">3</span>
                <span>Kendala yang dialami</span>
              </label>
              <button
                type="button"
                className={`btn small copy-btn ${
                  copiedId === "kendala" ? "copied" : ""
                }`}
                onClick={() => copyText(outKendala, "kendala")}
              >
                {copiedId === "kendala" ? (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Tersalin</span>
                  </>
                ) : (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>Salin</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              id="out-kendala"
              rows={3}
              value={outKendala}
              onChange={(e) => {
                setOutKendala(e.target.value);
                setLS("draft_out-kendala", e.target.value);
              }}
              placeholder="Kolom kendala akan terisi otomatis di sini..."
            />
            <div className="meta-bar">
              <div className="progress-track">
                <div
                  className={`progress-fill ${kendalaCount.cls}`}
                  style={{ width: `${kendalaCount.pct}%` }}
                />
              </div>
              <span className={`count-pill ${kendalaCount.cls}`}>
                {kendalaCount.txt}
              </span>
            </div>
          </div>

          <p className="hint" style={{ textAlign: "center", marginTop: "12px" }}>
            Anda tetap dapat mengedit langsung teks di atas sebelum menyalinnya
            ke formulir laporan.
          </p>
        </section>
      </main>

      <footer>
        Crafted by <strong>FREEKS</strong>
      </footer>

      {/* Modal Pengaturan AI */}
      <dialog ref={dialogRef}>
        <div className="dialog-head">
          <h2>Pengaturan AI</h2>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => dialogRef.current?.close()}
            aria-label="Tutup"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="field">
          <label htmlFor="s-key">Gemini API Key</label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              id="s-key"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Tempel API key Gemini Anda di sini"
            />
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? "Sembunyi" : "Lihat"}
            </button>
          </div>
          <p className="hint">
            Dapatkan gratis di{" "}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--primary)", fontWeight: 600 }}
            >
              aistudio.google.com/apikey
            </a>
            . Disimpan aman di browser perangkat ini.
          </p>
        </div>

        <div className="field">
          <label htmlFor="s-model">Model Gemini</label>
          <input
            id="s-model"
            type="text"
            autoComplete="off"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gemini-2.5-flash"
          />
          <p className="hint">
            Default: <code>gemini-2.5-flash</code>. Bisa diganti jika model
            sedang penuh.
          </p>
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => dialogRef.current?.close()}
          >
            Batal
          </button>
          <button type="button" className="btn" onClick={handleSaveSettings}>
            Simpan Pengaturan
          </button>
        </div>
      </dialog>

      {/* Modal Panduan Install di iPhone / iOS */}
      <dialog ref={iosDialogRef}>
        <div className="dialog-head">
          <h2>Pasang di iPhone / iPad</h2>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => iosDialogRef.current?.close()}
            aria-label="Tutup"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <p style={{ fontSize: "14px", margin: "0 0 12px" }}>
          Untuk mengunduh aplikasi ini ke layar utama iPhone/iPad Anda:
        </p>
        <ol style={{ fontSize: "14px", paddingLeft: "20px", margin: 0 }}>
          <li style={{ marginBottom: "8px" }}>
            Ketuk tombol <strong>Bagikan (Share)</strong> di bagian bawah
            browser Safari.
          </li>
          <li>
            Pilih <strong>&quot;Tambahkan ke Layar Utama&quot; (Add to Home Screen)</strong>.
          </li>
        </ol>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            onClick={() => iosDialogRef.current?.close()}
          >
            Mengerti
          </button>
        </div>
      </dialog>

      <div className={`toast ${toastVisible ? "show" : ""}`}>{toastMsg}</div>
    </>
  );
}
