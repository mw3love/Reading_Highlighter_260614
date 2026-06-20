const providerEl = document.getElementById("provider");
const providerHintEl = document.getElementById("provider-hint");
const keyEl = document.getElementById("key");
const modelEl = document.getElementById("model");
const statusEl = document.getElementById("status");

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || "";
}

// 제공자별 storage 슬롯·안내. 키·모델을 따로 저장해 전환해도 서로 안 지워진다.
const PROVIDERS = {
  gateway: {
    keyName: "gw_key",
    modelName: "gw_model",
    hint: "기관 게이트웨이(mindlogic) — 발급받은 키를 입력하세요.",
  },
  gemini: {
    keyName: "gemini_key",
    modelName: "gemini_model",
    hint: "Google AI Studio(aistudio.google.com/apikey)에서 무료 발급한 키 — \"AIza…\" 형식.",
  },
};

let provider = "gateway";

// 저장된 모델이 목록에 없을 수 있으니 임시 옵션을 보장
function ensureOption(id) {
  if (!id) return;
  if (![...modelEl.options].some((o) => o.value === id)) {
    modelEl.add(new Option(id, id));
  }
}

// 현재 입력값을 활성 제공자 슬롯에 저장(+활성 제공자 포인터). 워커는 ai_provider 로 base·키를 고른다.
async function persist() {
  const p = PROVIDERS[provider];
  await chrome.storage.local.set({
    ai_provider: provider,
    [p.keyName]: keyEl.value.trim(),
    [p.modelName]: modelEl.value,
  });
}

// 활성 제공자의 저장값을 UI 에 로드 + (키 있으면) 모델 목록 갱신
async function loadProviderIntoUI() {
  const p = PROVIDERS[provider];
  providerHintEl.textContent = p.hint;
  const stored = await chrome.storage.local.get([p.keyName, p.modelName]);
  keyEl.value = stored[p.keyName] || "";
  const savedModel = stored[p.modelName] || "gemini-2.5-flash";
  modelEl.innerHTML = "";
  ensureOption(savedModel); // 목록 로드 전이라도 선택 유지
  modelEl.value = savedModel;
  if (keyEl.value.trim()) loadModels(savedModel);
}

// 선택된 제공자(storage 의 ai_provider)의 모델 목록을 서버에서 불러와 채운다.
function loadModels(selectModel, onDone) {
  const want = selectModel || modelEl.value;
  chrome.runtime.sendMessage({ type: "gw-models" }, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      // 실패해도 기존 옵션 유지
      if (onDone)
        onDone(false, (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message));
      return;
    }
    // owner별로 정렬해 목록 구성
    const models = resp.models.slice().sort((a, b) => (a.owner + a.id).localeCompare(b.owner + b.id));
    modelEl.innerHTML = "";
    let lastOwner = null;
    let group = null;
    for (const m of models) {
      if (m.owner !== lastOwner) {
        group = document.createElement("optgroup");
        group.label = m.owner || "기타";
        modelEl.add(group);
        lastOwner = m.owner;
      }
      group.appendChild(new Option(m.id, m.id));
    }
    ensureOption(want);
    modelEl.value = want;
    if (onDone) onDone(true, models.length);
  });
}

// 초기 로드 — 활성 제공자 복원
chrome.storage.local.get("ai_provider").then(async ({ ai_provider }) => {
  provider = ai_provider || "gateway";
  providerEl.value = provider;
  await loadProviderIntoUI();
});

// 제공자 전환 — 전환 전 현재 입력을 이전 슬롯에 저장 → 새 제공자 값 로드
providerEl.addEventListener("change", async () => {
  await persist(); // provider 는 아직 이전 값 → 이전 슬롯에 저장됨
  provider = providerEl.value;
  await chrome.storage.local.set({ ai_provider: provider }); // 워커가 새 제공자로 모델 조회하도록 먼저 반영
  await loadProviderIntoUI();
  setStatus("", "");
});

document.getElementById("save").addEventListener("click", async () => {
  await persist();
  setStatus("저장됨.", "ok");
  if (keyEl.value.trim()) loadModels(); // 키가 있으면 전체 모델 목록 갱신
});

document.getElementById("refresh-models").addEventListener("click", async () => {
  await persist(); // 키·제공자 먼저 반영
  if (!keyEl.value.trim()) return setStatus("키를 먼저 입력하세요.", "err");
  setStatus("모델 목록 새로고침 중…", "");
  loadModels(null, (ok, info) => {
    if (ok) setStatus("모델 목록 갱신됨 (" + info + "개).", "ok");
    else setStatus("모델 목록 실패: " + (info || "알 수 없음"), "err");
  });
});

document.getElementById("test").addEventListener("click", async () => {
  await persist();
  if (!keyEl.value.trim()) return setStatus("키를 먼저 입력하세요.", "err");
  setStatus("테스트 중…", "");
  chrome.runtime.sendMessage({ type: "gw-test", model: modelEl.value }, (resp) => {
    if (chrome.runtime.lastError) {
      return setStatus("오류: " + chrome.runtime.lastError.message, "err");
    }
    if (resp && resp.ok) setStatus("연결 성공 ✓  응답: " + resp.reply, "ok");
    else setStatus("실패: " + ((resp && resp.error) || "알 수 없음"), "err");
  });
});

// ---------- Notion 설정 ----------
const notionTokenEl = document.getElementById("notion-token");
const notionParentEl = document.getElementById("notion-parent");
const notionStatusEl = document.getElementById("notion-status");

function setNotionStatus(text, cls) {
  notionStatusEl.textContent = text;
  notionStatusEl.className = cls || "";
}

chrome.storage.local.get(["notion_token", "notion_parent_id"]).then((s) => {
  if (s.notion_token) notionTokenEl.value = s.notion_token;
  if (s.notion_parent_id) notionParentEl.value = s.notion_parent_id;
});

async function persistNotion() {
  await chrome.storage.local.set({
    notion_token: notionTokenEl.value.trim(),
    notion_parent_id: notionParentEl.value.trim(),
  });
}

document.getElementById("notion-save").addEventListener("click", async () => {
  await persistNotion();
  setNotionStatus("저장됨.", "ok");
});

const notionDbSelectEl = document.getElementById("notion-db-select");
const notionDbPickEl = document.getElementById("notion-db-pick");

function hideDbPicker() {
  notionDbSelectEl.style.display = "none";
  notionDbPickEl.style.display = "none";
  notionDbSelectEl.innerHTML = "";
}

document.getElementById("notion-test").addEventListener("click", async () => {
  await persistNotion();
  hideDbPicker();
  if (!notionTokenEl.value.trim() || !notionParentEl.value.trim()) {
    return setNotionStatus("토큰과 부모 페이지를 먼저 입력하세요.", "err");
  }
  setNotionStatus("확인 중…", "");
  chrome.runtime.sendMessage(
    { type: "notion-connect", parentId: notionParentEl.value.trim() },
    (resp) => {
      if (chrome.runtime.lastError) {
        return setNotionStatus("오류: " + chrome.runtime.lastError.message, "err");
      }
      if (!resp || !resp.ok) {
        return setNotionStatus("실패: " + ((resp && resp.error) || "알 수 없음"), "err");
      }
      const base = '연결 성공 ✓  부모 페이지: "' + resp.title + '"';
      const db = resp.db || {};
      if (db.status === "single") {
        setNotionStatus(base + " — 기존 인박스 DB에 연결됨.", "ok");
      } else if (db.status === "none") {
        setNotionStatus(base + " — 저장 시 인박스 DB가 새로 생성됩니다.", "ok");
      } else if (db.status === "multiple") {
        setNotionStatus(base + " — 인박스 DB가 여러 개입니다. 사용할 DB를 선택하세요.", "err");
        for (const c of db.candidates || []) {
          const when = c.created ? new Date(c.created).toLocaleString() : "";
          const shortId = String(c.id).replace(/-/g, "").slice(0, 8);
          notionDbSelectEl.add(
            new Option(c.title + " — 생성 " + when + " (" + shortId + "…)", c.id)
          );
        }
        notionDbSelectEl.style.display = "block";
        notionDbPickEl.style.display = "inline-block";
      } else {
        setNotionStatus(base, "ok");
      }
    }
  );
});

notionDbPickEl.addEventListener("click", () => {
  const databaseId = notionDbSelectEl.value;
  if (!databaseId) return;
  setNotionStatus("연결 중…", "");
  chrome.runtime.sendMessage(
    { type: "notion-pick-db", parentId: notionParentEl.value.trim(), databaseId },
    (resp) => {
      if (chrome.runtime.lastError) {
        return setNotionStatus("오류: " + chrome.runtime.lastError.message, "err");
      }
      if (resp && resp.ok) {
        hideDbPicker();
        setNotionStatus("선택한 DB에 연결됨 ✓", "ok");
      } else {
        setNotionStatus("실패: " + ((resp && resp.error) || "알 수 없음"), "err");
      }
    }
  );
});
