import { useState, useRef, useEffect } from "react";

// ---------------------------------------------------------------------------
// BUBBLE API
// ---------------------------------------------------------------------------
const BUBBLE_API = "https://yogrr.com/version-test/api/1.1/obj/run%20listing";

async function fetchRuns() {
  try {
    const res = await fetch(`${BUBBLE_API}?limit=100`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.response?.results || [];
  } catch (e) {
    console.error("Failed to fetch runs:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// FIELD MAPPING — converts raw Bubble fields to clean objects
// ---------------------------------------------------------------------------
function mapRun(r) {
  const isClub = r["16 RC listing"] === true;
  const scheduleType = isClub
    ? r["07B RC one off or repeats"] || "One off"
    : "One off";

  let schedule = "";
  if (scheduleType === "One off") {
    const date = r["08 Run date"]
      ? new Date(r["08 Run date"]).toLocaleDateString("en-NZ", {
          weekday: "long", day: "numeric", month: "long", year: "numeric",
        })
      : null;
    const time = r["09A One off or date run info"] || "";
    schedule = [date, time].filter(Boolean).join(" at ") || "Date TBC";
  } else {
    // Repeating
    const days = (r["09C Run days"] || []).join(", ");
    const time = r["09A One off or date run info"] || "";
    schedule = [days, time].filter(Boolean).join(" at ") || "Regular run";
  }

  const distMin = r["10A Length min"];
  const distMax = r["10B Length max"];
  const distUnit = r["10C Length unit"] || "Kms";
  let distance = "Any distance";
  if (distMin != null && distMax != null) {
    distance = distMin === distMax
      ? `${distMin} ${distUnit}`
      : `${distMin}–${distMax} ${distUnit}`;
  } else if (distMin != null) {
    distance = `${distMin}+ ${distUnit}`;
  } else if (distMax != null) {
    distance = `Up to ${distMax} ${distUnit}`;
  }

  const paceMin = r["12A Pace min"];
  const paceMax = r["12B Pace max"];
  let pace = "Any pace";
  if (paceMin && paceMax && paceMin > 0 && paceMax > 0) {
    pace = `${paceMin}–${paceMax} min/km`;
  } else if (paceMax && paceMax > 0) {
    pace = `Up to ${paceMax} min/km`;
  } else if (paceMin && paceMin > 0) {
    pace = `${paceMin}+ min/km`;
  }

  return {
    id: r["_id"],
    title: r["01 Title"] || "Untitled run",
    description: r["02 Info"] || "",
    type: r["03 Type"] || "Other",
    region: r["04 Region"] || "",
    district: r["05 District"] || "",
    schedule,
    scheduleType,
    isClub,
    distance,
    pace,
    genders: (r["15 Run gender"] || []).join(", "),
    status: r["14 Status"],
    messagesAllowed: r["17 Allow messages"],
    paidOnly: r["22 RC paid members only"],
    createdByType: r["20 Created by user type"] || "",
  };
}

// ---------------------------------------------------------------------------
// SYSTEM PROMPT BUILDER
// ---------------------------------------------------------------------------
function buildSystemPrompt(runs, userProfile) {
  const runSummary = runs.length === 0
    ? "No runs are currently listed."
    : runs
        .filter(r => r.status === "active")
        .map(r =>
          `- **${r.title}** (${r.type}) | ${r.region}${r.district ? ", " + r.district : ""} | ${r.schedule} | Distance: ${r.distance} | Pace: ${r.pace} | Open to: ${r.genders || "all"} | Posted by: ${r.createdByType}${r.description ? " | Notes: " + r.description : ""}`
        )
        .join("\n");

  const profileSection = userProfile
    ? `
## Current User Profile
The user is logged in. Use this to personalise your responses:
- Name: ${userProfile.name || "Runner"}
- Region: ${userProfile.region || "not specified"}${userProfile.district ? ", " + userProfile.district : ""}
- Preferred distance: ${userProfile.distMin && userProfile.distMax ? userProfile.distMin + "–" + userProfile.distMax + " km" : "not specified"}
- Preferred pace: ${userProfile.paceMin && userProfile.paceMax ? userProfile.paceMin + "–" + userProfile.paceMax + " min/km" : "not specified"}
- Gender: ${userProfile.gender || "not specified"}

Lead with runs that best match their profile. Reference their preferences naturally (e.g. "given you prefer 10–15km runs..."). Don't mention fields you weren't given.`
    : `
## Current User
The user is not logged in. Help them find runs based on what they tell you in conversation. At natural moments — especially if they ask "which suits me?" or similar — mention that logging in unlocks personalised matching based on their saved pace, distance and location preferences.`;

  return `You are Pace, the AI running assistant for Yogrr — a New Zealand platform where people post and find runs, connecting individual runners and run clubs across Aotearoa.
${profileSection}

## Live Run Listings from Yogrr
The following runs are currently listed. Use these as your source of truth — don't invent runs.

${runSummary}

## Run Types on Yogrr
Casual, Easy, Intervals, Race/Event, Tempo, Track, Trail, Other

## NZ Regions
Auckland, Waikato, Bay of Plenty, Gisborne, Hawke's Bay, Taranaki, Manawatū-Whanganui, Wellington, Tasman, Nelson, Marlborough, West Coast, Canterbury, Otago, Southland, Northland

## Scheduling types
- **One-off**: a specific date and time
- **Repeating** (run clubs only): recurring on set days, e.g. every Monday at 6pm

## Your behaviour
- Answer based only on the runs listed above. If nothing matches, say so honestly and suggest they post a listing or check back as more clubs join.
- When presenting runs, be concise and scannable. Lead with the most relevant matches.
- For pace, NZ runners talk in min/km (e.g. "5:30 pace").
- Distance can be in km, minutes, or hours depending on the run — reflect whichever unit is given.
- If pace or distance is "Any", that means the organiser has left it open to all abilities.
- Be friendly, encouraging, and NZ-local in tone (use NZ spelling: programme, colour, favour etc).
- If asked about something outside Yogrr (race results, nutrition, training plans), acknowledge warmly and redirect.
- Keep responses concise — a short list or 3–4 sentences is usually right.`;
}

// ---------------------------------------------------------------------------
// URL PARAM PARSER — reads user profile passed from Bubble when logged in
// ---------------------------------------------------------------------------
function parseUserProfile() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("region") && !params.get("name")) return null;
    return {
      name: params.get("name") || "",
      region: params.get("region") || "",
      district: params.get("district") || "",
      distMin: params.get("distMin") || "",
      distMax: params.get("distMax") || "",
      paceMin: params.get("paceMin") || "",
      paceMax: params.get("paceMax") || "",
      gender: params.get("gender") || "",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// COMPONENTS
// ---------------------------------------------------------------------------
const TypingIndicator = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "12px 16px" }}>
    {[0, 1, 2].map((i) => (
      <div key={i} style={{
        width: 7, height: 7, borderRadius: "50%", background: "#94a3b8",
        animation: "bounce 1.2s infinite", animationDelay: `${i * 0.2}s`,
      }} />
    ))}
  </div>
);

const SUGGESTED_PROMPTS = [
  "Find me a trail run in Wellington",
  "I'm a beginner — what suits me?",
  "Any running clubs in Canterbury?",
  "Show me Monday morning runs in Auckland",
  "What runs are on this weekend?",
];

// ---------------------------------------------------------------------------
// MAIN APP
// ---------------------------------------------------------------------------
export default function YogrrrAssistant() {
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState(false);
  const [userProfile] = useState(() => parseUserProfile());
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Load API key from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("yogrr_api_key");
    if (stored) setApiKey(stored);
  }, []);

  // Fetch runs on mount
  useEffect(() => {
    fetchRuns().then(raw => {
      if (raw.length === 0) setRunsError(true);
      setRuns(raw.map(mapRun));
      setRunsLoading(false);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const saveApiKey = () => {
    localStorage.setItem("yogrr_api_key", apiKeyInput);
    setApiKey(apiKeyInput);
    setShowSettings(false);
    setApiKeyInput("");
  };

  const sendMessage = async (text) => {
    if (!text.trim()) return;
    if (!apiKey) {
      setError("Please add your Anthropic API key in settings first.");
      setShowSettings(true);
      return;
    }
    setError("");

    const userMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: buildSystemPrompt(runs, userProfile),
          messages: newMessages,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const reply = data.content?.find(b => b.type === "text")?.text || "Sorry, I couldn't get a response.";
      setMessages([...newMessages, { role: "assistant", content: reply }]);
    } catch (e) {
      setError("Something went wrong: " + e.message);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const isFirstMessage = messages.length === 0;
  const greeting = userProfile?.name ? `Hi ${userProfile.name}` : "Find your perfect run";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f1a14; font-family: 'DM Sans', sans-serif; }

        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; } to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
        }

        .app { min-height: 100vh; background: #0f1a14; display: flex; flex-direction: column; max-width: 780px; margin: 0 auto; }

        .header { padding: 20px 24px 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.06); position: sticky; top: 0; background: #0f1a14; z-index: 10; }
        .logo-area { display: flex; align-items: center; gap: 10px; }
        .logo-dot { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #4ade80, #16a34a); display: flex; align-items: center; justify-content: center; font-size: 16px; }
        .logo-text { font-family: 'DM Serif Display', serif; color: #f0fdf4; font-size: 20px; letter-spacing: -0.3px; }
        .logo-sub { font-size: 11px; color: #4ade80; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 500; margin-top: -2px; }

        .header-right { display: flex; align-items: center; gap: 8px; }

        .data-status { font-size: 12px; padding: 4px 10px; border-radius: 20px; display: flex; align-items: center; gap: 5px; }
        .data-status.loading { background: rgba(148,163,184,0.1); color: #94a3b8; }
        .data-status.loaded { background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.2); color: #86efac; }
        .data-status.error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #fca5a5; }
        .data-status.loading .dot { animation: pulse 1.2s infinite; }

        .auth-badge { font-size: 12px; padding: 4px 10px; border-radius: 20px; background: rgba(96,165,250,0.1); border: 1px solid rgba(96,165,250,0.2); color: #93c5fd; }

        .settings-btn { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #94a3b8; padding: 6px 12px; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .settings-btn:hover { background: rgba(255,255,255,0.1); color: #e2e8f0; }

        .chat-area { flex: 1; overflow-y: auto; padding: 24px; scroll-behavior: smooth; }

        .welcome { animation: fadeUp 0.5s ease both; text-align: center; padding: 48px 24px 32px; }
        .welcome-icon { font-size: 40px; margin-bottom: 16px; }
        .welcome h1 { font-family: 'DM Serif Display', serif; color: #f0fdf4; font-size: 30px; letter-spacing: -0.5px; margin-bottom: 8px; }
        .welcome h1 em { color: #4ade80; font-style: italic; }
        .welcome p { color: #64748b; font-size: 15px; line-height: 1.6; max-width: 420px; margin: 0 auto 32px; }

        .run-count { display: inline-block; background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.15); color: #86efac; padding: 4px 12px; border-radius: 20px; font-size: 13px; margin-bottom: 24px; }

        .suggestions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
        .suggestion-chip { background: rgba(74,222,128,0.08); border: 1px solid rgba(74,222,128,0.2); color: #86efac; padding: 8px 14px; border-radius: 20px; font-size: 13px; cursor: pointer; transition: all 0.15s; font-family: 'DM Sans', sans-serif; }
        .suggestion-chip:hover { background: rgba(74,222,128,0.15); border-color: rgba(74,222,128,0.4); color: #4ade80; }

        .message-row { display: flex; margin-bottom: 20px; animation: fadeUp 0.3s ease both; }
        .message-row.user { justify-content: flex-end; }
        .message-row.assistant { justify-content: flex-start; }

        .avatar { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #4ade80, #16a34a); display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; margin-right: 10px; margin-top: 2px; }

        .bubble { max-width: 72%; padding: 12px 16px; border-radius: 16px; font-size: 14.5px; line-height: 1.65; }
        .bubble.user { background: #166534; color: #dcfce7; border-bottom-right-radius: 4px; }
        .bubble.assistant { background: #1e2d24; color: #cbd5e1; border-bottom-left-radius: 4px; border: 1px solid rgba(255,255,255,0.06); }
        .bubble.assistant strong { color: #86efac; font-weight: 600; }
        .bubble.assistant ul, .bubble.assistant ol { padding-left: 18px; margin: 6px 0; }
        .bubble.assistant li { margin-bottom: 4px; }

        .typing-bubble { background: #1e2d24; border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; border-bottom-left-radius: 4px; }

        .input-area { padding: 16px 24px 24px; border-top: 1px solid rgba(255,255,255,0.06); background: #0f1a14; }
        .input-row { display: flex; gap: 10px; align-items: flex-end; background: #1a2b20; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 10px 10px 10px 16px; transition: border-color 0.15s; }
        .input-row:focus-within { border-color: rgba(74,222,128,0.4); }
        .input-row textarea { flex: 1; background: transparent; border: none; outline: none; color: #e2e8f0; font-size: 14.5px; font-family: 'DM Sans', sans-serif; resize: none; max-height: 120px; line-height: 1.5; }
        .input-row textarea::placeholder { color: #475569; }

        .send-btn { width: 36px; height: 36px; border-radius: 9px; background: #16a34a; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; color: white; }
        .send-btn:hover:not(:disabled) { background: #15803d; transform: scale(1.05); }
        .send-btn:disabled { background: #1f3a28; cursor: not-allowed; color: #4b5563; }

        .error-bar { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #fca5a5; padding: 10px 16px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; animation: fadeIn 0.2s ease; }

        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; animation: fadeIn 0.2s ease; padding: 24px; }
        .modal { background: #1a2b20; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 28px; width: 100%; max-width: 440px; animation: fadeUp 0.25s ease; }
        .modal h2 { font-family: 'DM Serif Display', serif; color: #f0fdf4; font-size: 22px; margin-bottom: 8px; }
        .modal p { color: #64748b; font-size: 13.5px; line-height: 1.6; margin-bottom: 20px; }
        .modal p a { color: #4ade80; text-decoration: none; }
        .modal input { width: 100%; background: #0f1a14; border: 1px solid rgba(255,255,255,0.1); border-radius: 9px; padding: 11px 14px; color: #e2e8f0; font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none; margin-bottom: 14px; transition: border-color 0.15s; }
        .modal input:focus { border-color: rgba(74,222,128,0.4); }
        .modal-btns { display: flex; gap: 10px; justify-content: flex-end; }
        .btn-secondary { background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; padding: 9px 16px; border-radius: 8px; font-size: 14px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .btn-secondary:hover { border-color: rgba(255,255,255,0.2); color: #e2e8f0; }
        .btn-primary { background: #16a34a; border: none; color: white; padding: 9px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .btn-primary:hover { background: #15803d; }
        .btn-primary:disabled { background: #1f3a28; color: #4b5563; cursor: not-allowed; }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e3a28; border-radius: 2px; }
      `}</style>

      <div className="app">
        {/* Header */}
        <div className="header">
          <div className="logo-area">
            <div className="logo-dot">🏃</div>
            <div>
              <div className="logo-text">Yogrr</div>
              <div className="logo-sub">AI Assistant</div>
            </div>
          </div>
          <div className="header-right">
            {/* Data fetch status */}
            {runsLoading && (
              <span className="data-status loading">
                <span className="dot">●</span> Loading runs…
              </span>
            )}
            {!runsLoading && !runsError && (
              <span className="data-status loaded">
                ● {runs.filter(r => r.status === "active").length} runs live
              </span>
            )}
            {!runsLoading && runsError && (
              <span className="data-status error">● Data unavailable</span>
            )}
            {/* Auth status */}
            {userProfile && (
              <span className="auth-badge">● {userProfile.name || "Logged in"}</span>
            )}
            <button className="settings-btn" onClick={() => setShowSettings(true)}>
              Settings
            </button>
          </div>
        </div>

        {/* Chat */}
        <div className="chat-area">
          {isFirstMessage && (
            <div className="welcome">
              <div className="welcome-icon">🏔️</div>
              <h1>
                {userProfile?.name
                  ? <><em>Kia ora</em>, {userProfile.name}</>
                  : <>Find your <em>perfect run</em></>
                }
              </h1>
              <p>
                {userProfile
                  ? `I know your preferences — let me find runs that match you across Aotearoa.`
                  : `Tell me what you're looking for — distance, terrain, location, schedule — and I'll find your match across Aotearoa.`
                }
              </p>
              {!runsLoading && runs.length > 0 && (
                <div className="run-count">
                  {runs.filter(r => r.status === "active").length} runs currently listed on Yogrr
                </div>
              )}
              <div className="suggestions">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button key={p} className="suggestion-chip" onClick={() => sendMessage(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`message-row ${msg.role}`}>
              {msg.role === "assistant" && <div className="avatar">🏃</div>}
              <div
                className={`bubble ${msg.role}`}
                dangerouslySetInnerHTML={{
                  __html: msg.content
                    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                    .replace(/\n/g, "<br/>"),
                }}
              />
            </div>
          ))}

          {loading && (
            <div className="message-row assistant">
              <div className="avatar">🏃</div>
              <div className="typing-bubble"><TypingIndicator /></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="input-area">
          {error && <div className="error-bar">{error}</div>}
          <div className="input-row">
            <textarea
              ref={inputRef}
              rows={1}
              placeholder={runsLoading ? "Loading run data…" : "Ask about runs, clubs, routes in NZ…"}
              value={input}
              disabled={runsLoading}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKey}
            />
            <button
              className="send-btn"
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim() || runsLoading}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowSettings(false)}>
          <div className="modal">
            <h2>API Settings</h2>
            <p>
              Enter your Anthropic API key to enable the AI assistant. Get one at{" "}
              <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">
                console.anthropic.com
              </a>. Your key is stored locally in your browser only.
            </p>
            <input
              type="password"
              placeholder="sk-ant-…"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveApiKey()}
              autoFocus
            />
            <div className="modal-btns">
              <button className="btn-secondary" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveApiKey} disabled={!apiKeyInput.trim()}>
                Save key
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
