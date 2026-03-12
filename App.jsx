import { useState, useCallback, useRef } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

// ─── Firebase Firestore Storage ───────────────────────────────────────────────
const DOC_REF = () => doc(db, "vending", "appData");

const defaultData = {
  products: [],
  inventory: [],
  inventoryLogs: [],
  salesData: [],
};

async function loadData() {
  try {
    const snap = await getDoc(DOC_REF());
    if (snap.exists()) {
      // Firestore에 데이터 있으면 반환
      return { ...defaultData, ...snap.data() };
    }
    // 첫 실행 시 기본값으로 초기화
    await setDoc(DOC_REF(), defaultData);
    return defaultData;
  } catch (e) {
    console.error("Firebase 불러오기 실패:", e);
    return defaultData;
  }
}

async function saveData(data) {
  try {
    await setDoc(DOC_REF(), data);
  } catch (e) {
    console.error("Firebase 저장 실패:", e);
  }
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const Icon = ({ d, size = 18, color = "currentColor", stroke = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const icons = {
  home: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  box: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
  chart: "M18 20V10 M12 20V4 M6 20v-6",
  machine: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M9 3v18 M15 9h.01 M15 12h.01 M15 15h.01",
  tag: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
  x: "M18 6L6 18 M6 6l12 12",
  check: "M20 6L9 17l-5-5",
  calendar: "M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18",
  trophy: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22 M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22 M18 2H6v7a6 6 0 0 0 12 0V2z",
  edit: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  trash: "M3 6h18 M19 6l-1 14H6L5 6 M8 6V4h8v2",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);

const fmt = (n) => n?.toLocaleString("ko-KR") ?? 0;

const COLUMN_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const ROW_LABELS = [1, 2, 3, 4, 5, 6];

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("home");
  const [appData, setAppData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load data on mount
  useState(() => {
    loadData().then((d) => {
      setAppData(d);
      setLoading(false);
    });
  });

  const updateData = useCallback((updater) => {
    setAppData((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveData(next);
      return next;
    });
  }, []);

  if (loading || !appData) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0f0f14", color: "#f0e6d3", fontFamily: "'Noto Sans KR', sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🥤</div>
          <div style={{ fontSize: 18, opacity: 0.7 }}>로딩 중...</div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "home", label: "홈", icon: icons.home },
    { id: "inventory", label: "재고", icon: icons.box },
    { id: "sales", label: "판매 통계", icon: icons.chart },
    { id: "machine", label: "자판기", icon: icons.machine },
    { id: "products", label: "제품 등록", icon: icons.tag },
  ];

  return (
    <div style={{
      fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",
      background: "#0f0f14",
      minHeight: "100vh",
      color: "#e8ddd0",
      display: "flex",
      flexDirection: "column",
      maxWidth: 480,
      margin: "0 auto",
      position: "relative",
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #1a1a24 0%, #16161e 100%)",
        borderBottom: "1px solid #2a2a3a",
        padding: "16px 20px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <span style={{ fontSize: 22 }}>🥤</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f0e6d3", letterSpacing: "-0.3px" }}>자판기 관리</div>
          <div style={{ fontSize: 11, color: "#8888aa", marginTop: 1 }}>Vending Manager</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
        {tab === "home" && <HomeTab data={appData} updateData={updateData} />}
        {tab === "inventory" && <InventoryTab data={appData} updateData={updateData} />}
        {tab === "sales" && <SalesTab data={appData} updateData={updateData} />}
        {tab === "machine" && <MachineTab data={appData} />}
        {tab === "products" && <ProductsTab data={appData} updateData={updateData} />}
      </div>

      {/* Bottom Nav */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: 480,
        background: "#13131c",
        borderTop: "1px solid #2a2a3a",
        display: "flex",
        zIndex: 100,
      }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1,
            background: "none",
            border: "none",
            padding: "10px 4px 8px",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
            color: tab === t.id ? "#e8b86d" : "#5a5a7a",
            transition: "color 0.2s",
          }}>
            <Icon d={t.icon} size={20} color={tab === t.id ? "#e8b86d" : "#5a5a7a"} />
            <span style={{ fontSize: 10, fontWeight: tab === t.id ? 600 : 400 }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── HOME TAB ─────────────────────────────────────────────────────────────────
function HomeTab({ data, updateData }) {
  const [selectedDate, setSelectedDate] = useState(today());

  const { products, inventory, salesData } = data;

  // Low stock products (≤ 5)
  const lowStock = inventory.filter((inv) => inv.qty <= 5).map((inv) => ({
    ...inv,
    product: products.find((p) => p.id === inv.productId),
  })).filter((i) => i.product);

  // Sales for selected date
  const daySales = salesData.filter((s) => s.date === selectedDate);

  const totalQty = daySales.reduce((sum, s) => sum + (s.qty || 0), 0);
  const totalAmt = daySales.reduce((sum, s) => {
    const prod = products.find((p) => p.id === s.productId);
    return sum + (s.qty || 0) * (prod?.sellPrice || 0);
  }, 0);

  // Top 3 products
  const salesByProduct = {};
  daySales.forEach((s) => {
    salesByProduct[s.productId] = (salesByProduct[s.productId] || 0) + s.qty;
  });
  const top3 = Object.entries(salesByProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
    .filter((e) => e.product);

  const rankColors = ["#e8b86d", "#b0b0c0", "#c87941"];
  const rankEmojis = ["🥇", "🥈", "🥉"];

  return (
    <div style={{ padding: 16 }}>
      {/* Date Picker */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "#8888aa", display: "block", marginBottom: 6 }}>날짜 선택</label>
        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
          style={{
            background: "#1e1e2c", border: "1px solid #3a3a50", borderRadius: 10,
            color: "#e8ddd0", padding: "10px 14px", fontSize: 14, width: "100%", boxSizing: "border-box",
          }}
        />
      </div>

      {/* Low Stock Section */}
      <SectionCard title="⚠️ 재고 부족 제품" subtitle="재고 5개 이하" accent="#e05050">
        {lowStock.length === 0 ? (
          <EmptyState icon="✅" text="재고 부족 제품 없음" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lowStock.map((item) => (
              <div key={item.productId} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "rgba(224,80,80,0.08)", borderRadius: 8, padding: "10px 12px",
                border: "1px solid rgba(224,80,80,0.2)",
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{item.product.name}</div>
                  <div style={{ fontSize: 11, color: "#8888aa", marginTop: 2 }}>컬럼: {item.product.column || "-"}</div>
                </div>
                <div style={{
                  background: item.qty === 0 ? "#e05050" : "#c86040",
                  color: "#fff", borderRadius: 20, padding: "3px 12px", fontSize: 13, fontWeight: 700,
                }}>{item.qty}개</div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Day Sales Section */}
      <SectionCard title={`📊 ${selectedDate} 판매 현황`} accent="#e8b86d">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <StatBox label="판매 수량" value={`${fmt(totalQty)}개`} color="#7ec8e3" />
          <StatBox label="판매 금액" value={`${fmt(totalAmt)}원`} color="#e8b86d" />
        </div>

        <div style={{ fontSize: 12, color: "#8888aa", marginBottom: 8, fontWeight: 600 }}>TOP 3 판매 제품</div>
        {top3.length === 0 ? (
          <EmptyState icon="📦" text="판매 데이터 없음" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {top3.map((item, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "#1e1e2c", borderRadius: 8, padding: "10px 12px",
                border: `1px solid ${rankColors[i]}33`,
              }}>
                <span style={{ fontSize: 20 }}>{rankEmojis[i]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{item.product.name}</div>
                </div>
                <div style={{ color: rankColors[i], fontWeight: 700, fontSize: 15 }}>{item.qty}개</div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── INVENTORY TAB ────────────────────────────────────────────────────────────
function InventoryTab({ data, updateData }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ productId: "", qty: "", direction: "plus", memo: "" });
  const [msg, setMsg] = useState(null);

  const { products, inventory } = data;

  const getQty = (productId) => {
    const inv = inventory.find((i) => i.productId === productId);
    return inv ? inv.qty : 0;
  };

  const handleSubmit = () => {
    if (!form.productId || !form.qty) return;
    const qty = parseInt(form.qty);
    if (isNaN(qty) || qty <= 0) return;
    const delta = form.direction === "plus" ? qty : -qty;

    updateData((prev) => {
      const invIdx = prev.inventory.findIndex((i) => i.productId === form.productId);
      let newInv = [...prev.inventory];
      if (invIdx >= 0) {
        newInv[invIdx] = { ...newInv[invIdx], qty: Math.max(0, newInv[invIdx].qty + delta) };
      } else {
        newInv.push({ productId: form.productId, qty: Math.max(0, delta) });
      }
      const log = {
        id: Date.now().toString(),
        productId: form.productId,
        delta,
        memo: form.memo,
        date: today(),
        time: new Date().toLocaleTimeString("ko-KR"),
      };
      return { ...prev, inventory: newInv, inventoryLogs: [...prev.inventoryLogs, log] };
    });

    setMsg(form.direction === "plus" ? `+${qty}개 입고 완료` : `-${qty}개 출고 완료`);
    setTimeout(() => setMsg(null), 2000);
    setShowModal(false);
    setForm({ productId: "", qty: "", direction: "plus", memo: "" });
  };

  return (
    <div style={{ padding: 16 }}>
      {msg && (
        <div style={{
          background: "#2a4a2a", border: "1px solid #4a8a4a", borderRadius: 10,
          padding: "10px 14px", marginBottom: 12, fontSize: 14, color: "#8ada8a",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <Icon d={icons.check} size={16} color="#8ada8a" /> {msg}
        </div>
      )}

      <button onClick={() => setShowModal(true)} style={{
        width: "100%", background: "linear-gradient(135deg, #e8b86d 0%, #d49a50 100%)",
        border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700,
        color: "#1a1208", cursor: "pointer", display: "flex", alignItems: "center",
        justifyContent: "center", gap: 8, marginBottom: 20,
      }}>
        <Icon d={icons.plus} size={18} color="#1a1208" /> 재고 입력
      </button>

      <SectionCard title="전체 재고 현황" accent="#7ec8e3">
        {products.length === 0 ? (
          <EmptyState icon="📦" text="등록된 제품이 없습니다" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {products.map((p) => {
              const qty = getQty(p.id);
              const isLow = qty <= 5;
              return (
                <div key={p.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "#1e1e2c", borderRadius: 8, padding: "12px 14px",
                  border: isLow ? "1px solid rgba(224,80,80,0.3)" : "1px solid #2a2a3a",
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#8888aa", marginTop: 2 }}>
                      컬럼: {p.column || "-"} | 판매가: {fmt(p.sellPrice)}원
                    </div>
                  </div>
                  <div style={{
                    background: isLow ? (qty === 0 ? "#e05050" : "#8a4020") : "#1a3a2a",
                    color: isLow ? "#fff" : "#8ada8a",
                    borderRadius: 20, padding: "4px 14px", fontSize: 14, fontWeight: 700,
                    minWidth: 48, textAlign: "center",
                  }}>{qty}개</div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Modal */}
      {showModal && (
        <Modal title="재고 입력" onClose={() => setShowModal(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>제품 선택</label>
              <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} style={inputStyle}>
                <option value="">제품을 선택하세요</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>수량</label>
              <input type="number" placeholder="수량 입력" value={form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>입출고 선택</label>
              <div style={{ display: "flex", gap: 8 }}>
                {[["plus", "➕ 입고"], ["minus", "➖ 출고"]].map(([v, label]) => (
                  <button key={v} onClick={() => setForm({ ...form, direction: v })} style={{
                    flex: 1, padding: "10px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: form.direction === v ? (v === "plus" ? "#2a5a2a" : "#5a1a1a") : "#2a2a3a",
                    color: form.direction === v ? (v === "plus" ? "#8ada8a" : "#f08080") : "#8888aa",
                    fontWeight: form.direction === v ? 700 : 400, fontSize: 14,
                  }}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={labelStyle}>메모 (선택)</label>
              <input type="text" placeholder="메모를 입력하세요" value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })} style={inputStyle} />
            </div>
            <button onClick={handleSubmit} style={primaryBtn}>확인</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── SALES TAB ────────────────────────────────────────────────────────────────
function SalesTab({ data, updateData }) {
  const [sortMode, setSortMode] = useState("date"); // date | product | qty
  const [selectedDate, setSelectedDate] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [mapping, setMapping] = useState({ dateCol: "", qtyCol: "", productCol: "" });
  const [mappingStep, setMappingStep] = useState(false);
  const fileRef = useRef();

  const { products, salesData } = data;

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const lines = text.trim().split("\n").map((l) => l.split(",").map((c) => c.trim().replace(/"/g, "")));
      if (lines.length < 2) return;
      setCsvHeaders(lines[0]);
      setCsvRows(lines.slice(1));
      setMappingStep(true);
    };
    reader.readAsText(file, "utf-8");
  };

  const handleImport = () => {
    if (!mapping.dateCol || !mapping.qtyCol || !mapping.productCol) return;
    const dateIdx = csvHeaders.indexOf(mapping.dateCol);
    const qtyIdx = csvHeaders.indexOf(mapping.qtyCol);
    const prodIdx = csvHeaders.indexOf(mapping.productCol);

    const newSales = [];
    csvRows.forEach((row) => {
      const dateVal = row[dateIdx];
      const qtyVal = parseInt(row[qtyIdx]);
      const prodName = row[prodIdx];
      if (!dateVal || isNaN(qtyVal)) return;
      const product = products.find((p) => p.name === prodName || p.column === prodName);
      if (!product) return;
      newSales.push({ id: Date.now().toString() + Math.random(), date: dateVal, productId: product.id, qty: qtyVal });
    });

    updateData((prev) => ({ ...prev, salesData: [...prev.salesData, ...newSales] }));
    setShowUpload(false);
    setMappingStep(false);
    setCsvHeaders([]);
    setCsvRows([]);
    setMapping({ dateCol: "", qtyCol: "", productCol: "" });
  };

  // Process sales data
  const filteredSales = selectedDate ? salesData.filter((s) => s.date === selectedDate) : salesData;

  // By date
  const byDate = {};
  filteredSales.forEach((s) => {
    if (!byDate[s.date]) byDate[s.date] = { qty: 0, amt: 0 };
    const prod = products.find((p) => p.id === s.productId);
    byDate[s.date].qty += s.qty;
    byDate[s.date].amt += s.qty * (prod?.sellPrice || 0);
  });

  // By product
  const byProduct = {};
  filteredSales.forEach((s) => {
    if (!byProduct[s.productId]) byProduct[s.productId] = 0;
    byProduct[s.productId] += s.qty;
  });

  const sortedDates = Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0]));
  const sortedProducts = Object.entries(byProduct)
    .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
    .filter((e) => e.product)
    .sort((a, b) => (sortMode === "product" ? a.product.name.localeCompare(b.product.name) : b.qty - a.qty));

  return (
    <div style={{ padding: 16 }}>
      <button onClick={() => setShowUpload(true)} style={{
        width: "100%", background: "linear-gradient(135deg, #4a6ee8 0%, #3a5ed8 100%)",
        border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700,
        color: "#fff", cursor: "pointer", display: "flex", alignItems: "center",
        justifyContent: "center", gap: 8, marginBottom: 16,
      }}>
        <Icon d={icons.upload} size={18} color="#fff" /> 판매 데이터 업로드 (CSV)
      </button>

      {/* Sort Tabs */}
      <div style={{ display: "flex", background: "#1e1e2c", borderRadius: 10, padding: 4, marginBottom: 16 }}>
        {[["date", "📅 날짜별"], ["product", "📦 제품명"], ["qty", "🔢 판매량"]].map(([v, label]) => (
          <button key={v} onClick={() => setSortMode(v)} style={{
            flex: 1, padding: "8px 4px", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12,
            background: sortMode === v ? "#e8b86d" : "transparent",
            color: sortMode === v ? "#1a1208" : "#8888aa", fontWeight: sortMode === v ? 700 : 400,
          }}>{label}</button>
        ))}
      </div>

      {/* Date filter */}
      <div style={{ marginBottom: 16 }}>
        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
          placeholder="날짜 필터"
          style={{ ...inputStyle, marginBottom: 0 }} />
        {selectedDate && (
          <button onClick={() => setSelectedDate("")} style={{
            marginTop: 6, background: "#2a2a3a", border: "none", borderRadius: 6,
            color: "#8888aa", padding: "4px 10px", fontSize: 12, cursor: "pointer",
          }}>필터 해제</button>
        )}
      </div>

      {sortMode === "date" ? (
        <SectionCard title="날짜별 판매 현황" accent="#e8b86d">
          {sortedDates.length === 0 ? <EmptyState icon="📊" text="판매 데이터 없음" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sortedDates.map(([date, val]) => (
                <div key={date} style={{ background: "#1e1e2c", borderRadius: 8, padding: "12px 14px", border: "1px solid #2a2a3a" }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, color: "#e8b86d" }}>{date}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                    <span style={{ color: "#7ec8e3" }}>판매량 <b>{fmt(val.qty)}개</b></span>
                    <span style={{ color: "#a8e8a8" }}>판매금액 <b>{fmt(val.amt)}원</b></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard title="제품별 총 판매량" accent="#7ec8e3">
          {sortedProducts.length === 0 ? <EmptyState icon="📦" text="판매 데이터 없음" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sortedProducts.map((item, i) => (
                <div key={item.product.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "#1e1e2c", borderRadius: 8, padding: "12px 14px", border: "1px solid #2a2a3a",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, color: "#8888aa", minWidth: 20 }}>#{i + 1}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{item.product.name}</div>
                      <div style={{ fontSize: 11, color: "#8888aa" }}>판매가 {fmt(item.product.sellPrice)}원</div>
                    </div>
                  </div>
                  <div style={{ color: "#7ec8e3", fontWeight: 700, fontSize: 15 }}>{item.qty}개</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <Modal title="판매 데이터 업로드" onClose={() => { setShowUpload(false); setMappingStep(false); }}>
          {!mappingStep ? (
            <div>
              <p style={{ fontSize: 13, color: "#8888aa", marginBottom: 14, lineHeight: 1.6 }}>
                CSV 파일을 업로드하세요.<br />날짜, 제품명, 판매 수량 컬럼이 포함되어야 합니다.
              </p>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
              <button onClick={() => fileRef.current?.click()} style={primaryBtn}>📁 CSV 파일 선택</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontSize: 13, color: "#8888aa", margin: 0 }}>파일 컬럼과 데이터 항목을 매칭하세요</p>
              {[
                ["dateCol", "📅 날짜 컬럼"],
                ["productCol", "📦 제품명 컬럼"],
                ["qtyCol", "🔢 수량 컬럼"],
              ].map(([key, label]) => (
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <select value={mapping[key]} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })} style={inputStyle}>
                    <option value="">선택하세요</option>
                    {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
              <button onClick={handleImport} style={primaryBtn}>데이터 불러오기</button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ─── MACHINE TAB ──────────────────────────────────────────────────────────────
function MachineTab({ data }) {
  const { products, inventory } = data;

  const getProduct = (col, row) => {
    return products.find((p) => p.column === `${col}${row}`);
  };

  const getQty = (productId) => {
    const inv = inventory.find((i) => i.productId === productId);
    return inv ? inv.qty : 0;
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>🏪 자판기 현황</div>
        <div style={{ fontSize: 12, color: "#8888aa" }}>컬럼별 제품 배치 현황</div>
      </div>

      {/* Vending Machine Visual */}
      <div style={{
        background: "linear-gradient(160deg, #1e2030 0%, #161620 100%)",
        borderRadius: 16, border: "2px solid #3a3a50",
        padding: 16, overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}>
        {/* Machine header */}
        <div style={{
          textAlign: "center", marginBottom: 14, padding: "8px",
          background: "linear-gradient(135deg, #e8b86d20, #e8b86d10)",
          borderRadius: 8, border: "1px solid #e8b86d30",
        }}>
          <div style={{ fontSize: 12, color: "#e8b86d", fontWeight: 700, letterSpacing: 2 }}>🥤 VENDING MACHINE</div>
        </div>

        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLUMN_LABELS.length}, 1fr)`, gap: 4, marginBottom: 6 }}>
          {COLUMN_LABELS.map((col) => (
            <div key={col} style={{ textAlign: "center", fontSize: 11, color: "#e8b86d", fontWeight: 700 }}>{col}</div>
          ))}
        </div>

        {/* Grid */}
        {ROW_LABELS.map((row) => (
          <div key={row} style={{ display: "grid", gridTemplateColumns: `repeat(${COLUMN_LABELS.length}, 1fr)`, gap: 4, marginBottom: 4 }}>
            {COLUMN_LABELS.map((col) => {
              const prod = getProduct(col, row);
              const qty = prod ? getQty(prod.id) : 0;
              const isEmpty = !prod;
              const isLow = prod && qty <= 5;
              return (
                <div key={col} style={{
                  background: isEmpty ? "#1a1a24" : (isLow ? "rgba(224,80,80,0.12)" : "rgba(126,200,227,0.08)"),
                  border: isEmpty ? "1px solid #2a2a3a" : (isLow ? "1px solid rgba(224,80,80,0.4)" : "1px solid rgba(126,200,227,0.3)"),
                  borderRadius: 6, padding: "6px 3px", textAlign: "center", minHeight: 60,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  position: "relative",
                }}>
                  {isEmpty ? (
                    <div style={{ fontSize: 16, opacity: 0.2 }}>□</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 16, marginBottom: 2 }}>🥤</div>
                      <div style={{ fontSize: 9, color: "#e8ddd0", fontWeight: 600, lineHeight: 1.2, textAlign: "center", overflow: "hidden", maxWidth: "100%" }}>
                        {prod.name.length > 5 ? prod.name.slice(0, 5) + "…" : prod.name}
                      </div>
                      <div style={{
                        fontSize: 9, marginTop: 2, fontWeight: 700,
                        color: isLow ? "#f08080" : "#8ada8a",
                      }}>{qty}개</div>
                    </>
                  )}
                  <div style={{ position: "absolute", top: 2, left: 3, fontSize: 8, color: "#5a5a7a" }}>{col}{row}</div>
                </div>
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div style={{ marginTop: 12, display: "flex", gap: 12, justifyContent: "center" }}>
          {[
            ["rgba(126,200,227,0.3)", "정상"],
            ["rgba(224,80,80,0.4)", "부족(≤5)"],
            ["#2a2a3a", "비어있음"],
          ].map(([color, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, border: `1px solid ${color}`, background: color + "40" }} />
              <span style={{ fontSize: 10, color: "#8888aa" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Product list */}
      <SectionCard title="컬럼 배치 현황" accent="#7ec8e3" style={{ marginTop: 16 }}>
        {products.filter(p => p.column).length === 0 ? (
          <EmptyState icon="🏪" text="컬럼이 배정된 제품이 없습니다" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {products.filter(p => p.column).sort((a,b) => a.column.localeCompare(b.column)).map((p) => {
              const qty = getQty(p.id);
              return (
                <div key={p.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "#1e1e2c", borderRadius: 8, padding: "10px 12px",
                  border: "1px solid #2a2a3a",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      background: "#e8b86d20", border: "1px solid #e8b86d50",
                      borderRadius: 6, padding: "3px 8px", fontSize: 12, fontWeight: 700, color: "#e8b86d",
                    }}>{p.column}</div>
                    <span style={{ fontSize: 14 }}>{p.name}</span>
                  </div>
                  <div style={{
                    color: qty <= 5 ? "#f08080" : "#8ada8a", fontWeight: 700, fontSize: 14,
                  }}>{qty}개</div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── PRODUCTS TAB ─────────────────────────────────────────────────────────────
function ProductsTab({ data, updateData }) {
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: "", buyPrice: "", totalQty: "", unitPrice: "", sellPrice: "", marginAmt: "", marginRate: "", column: "" });

  const { products } = data;

  const calcUnit = (buyPrice, totalQty) => {
    const bp = parseFloat(buyPrice);
    const tq = parseFloat(totalQty);
    if (!isNaN(bp) && !isNaN(tq) && tq > 0) return Math.round(bp / tq);
    return "";
  };

  const calcMargin = (sellPrice, unitPrice) => {
    const sp = parseFloat(sellPrice);
    const up = parseFloat(unitPrice);
    if (!isNaN(sp) && !isNaN(up)) {
      return { marginAmt: sp - up, marginRate: up > 0 ? Math.round(((sp - up) / sp) * 100) : 0 };
    }
    return { marginAmt: "", marginRate: "" };
  };

  const handleChange = (field, value) => {
    let updated = { ...form, [field]: value };
    if (field === "buyPrice" || field === "totalQty") {
      const unit = calcUnit(field === "buyPrice" ? value : form.buyPrice, field === "totalQty" ? value : form.totalQty);
      updated.unitPrice = unit;
      if (form.sellPrice) {
        const m = calcMargin(form.sellPrice, unit);
        updated = { ...updated, ...m };
      }
    }
    if (field === "sellPrice") {
      const m = calcMargin(value, updated.unitPrice);
      updated = { ...updated, ...m };
    }
    setForm(updated);
  };

  const handleSave = () => {
    if (!form.name) return;
    const product = {
      id: editId || Date.now().toString(),
      name: form.name,
      buyPrice: parseFloat(form.buyPrice) || 0,
      totalQty: parseFloat(form.totalQty) || 0,
      unitPrice: parseFloat(form.unitPrice) || 0,
      sellPrice: parseFloat(form.sellPrice) || 0,
      marginAmt: parseFloat(form.marginAmt) || 0,
      marginRate: parseFloat(form.marginRate) || 0,
      column: form.column,
    };
    updateData((prev) => {
      if (editId) {
        return { ...prev, products: prev.products.map((p) => p.id === editId ? product : p) };
      }
      return { ...prev, products: [...prev.products, product] };
    });
    setShowModal(false);
    setEditId(null);
    setForm({ name: "", buyPrice: "", totalQty: "", unitPrice: "", sellPrice: "", marginAmt: "", marginRate: "", column: "" });
  };

  const handleEdit = (p) => {
    setEditId(p.id);
    setForm({
      name: p.name, buyPrice: p.buyPrice, totalQty: p.totalQty,
      unitPrice: p.unitPrice, sellPrice: p.sellPrice, marginAmt: p.marginAmt,
      marginRate: p.marginRate, column: p.column || "",
    });
    setShowModal(true);
  };

  const handleDelete = (id) => {
    updateData((prev) => ({ ...prev, products: prev.products.filter((p) => p.id !== id) }));
  };

  return (
    <div style={{ padding: 16 }}>
      <button onClick={() => { setEditId(null); setForm({ name: "", buyPrice: "", totalQty: "", unitPrice: "", sellPrice: "", marginAmt: "", marginRate: "", column: "" }); setShowModal(true); }} style={{
        width: "100%", background: "linear-gradient(135deg, #e8b86d 0%, #d49a50 100%)",
        border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700,
        color: "#1a1208", cursor: "pointer", display: "flex", alignItems: "center",
        justifyContent: "center", gap: 8, marginBottom: 20,
      }}>
        <Icon d={icons.plus} size={18} color="#1a1208" /> 제품 등록
      </button>

      <SectionCard title={`등록 제품 (${products.length}개)`} accent="#e8b86d">
        {products.length === 0 ? (
          <EmptyState icon="🏷️" text="등록된 제품이 없습니다" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {products.map((p) => (
              <div key={p.id} style={{ background: "#1e1e2c", borderRadius: 10, border: "1px solid #2a2a3a", overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#8888aa", marginTop: 2 }}>컬럼: {p.column || "미배정"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => handleEdit(p)} style={{ background: "#2a3a5a", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", color: "#7ec8e3", fontSize: 12 }}>수정</button>
                    <button onClick={() => handleDelete(p.id)} style={{ background: "#3a1a1a", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", color: "#f08080", fontSize: 12 }}>삭제</button>
                  </div>
                </div>
                <div style={{ padding: "8px 14px 12px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[
                    ["구매가", `${fmt(p.buyPrice)}원`],
                    ["낱개가", `${fmt(p.unitPrice)}원`],
                    ["판매가", `${fmt(p.sellPrice)}원`],
                    ["마진가", `${fmt(p.marginAmt)}원`],
                    ["마진율", `${p.marginRate}%`],
                    ["총수량", `${p.totalQty}개`],
                  ].map(([label, val]) => (
                    <div key={label} style={{ background: "#13131c", borderRadius: 6, padding: "6px 8px" }}>
                      <div style={{ fontSize: 10, color: "#8888aa" }}>{label}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#e8ddd0" }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {showModal && (
        <Modal title={editId ? "제품 수정" : "제품 등록"} onClose={() => { setShowModal(false); setEditId(null); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              ["name", "제품명", "text", "제품명 입력"],
              ["buyPrice", "구매가 (원)", "number", "전체 구매 금액"],
              ["totalQty", "총 수량 (개)", "number", "구매 총 수량"],
            ].map(([key, label, type, ph]) => (
              <div key={key}>
                <label style={labelStyle}>{label}</label>
                <input type={type} placeholder={ph} value={form[key]} onChange={(e) => handleChange(key, e.target.value)} style={inputStyle} />
              </div>
            ))}

            <div>
              <label style={labelStyle}>낱개가 (자동계산)</label>
              <div style={{ ...inputStyle, background: "#13131c", color: "#8ada8a", fontWeight: 600 }}>
                {form.unitPrice ? `${fmt(form.unitPrice)}원` : "구매가 ÷ 총수량"}
              </div>
            </div>

            <div>
              <label style={labelStyle}>판매가 (원)</label>
              <input type="number" placeholder="판매 가격" value={form.sellPrice} onChange={(e) => handleChange("sellPrice", e.target.value)} style={inputStyle} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>마진가 (자동)</label>
                <div style={{ ...inputStyle, background: "#13131c", color: "#e8b86d", fontWeight: 600 }}>
                  {form.marginAmt !== "" ? `${fmt(form.marginAmt)}원` : "-"}
                </div>
              </div>
              <div>
                <label style={labelStyle}>마진율 (자동)</label>
                <div style={{ ...inputStyle, background: "#13131c", color: "#e8b86d", fontWeight: 600 }}>
                  {form.marginRate !== "" ? `${form.marginRate}%` : "-"}
                </div>
              </div>
            </div>

            <div>
              <label style={labelStyle}>컬럼 위치 (예: A1, B3)</label>
              <input type="text" placeholder="A1, B2 등 입력" value={form.column} onChange={(e) => handleChange("column", e.target.value.toUpperCase())} style={inputStyle} />
            </div>

            <button onClick={handleSave} style={primaryBtn}>{editId ? "수정 완료" : "등록 완료"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── UI Components ────────────────────────────────────────────────────────────
function SectionCard({ title, subtitle, accent = "#e8b86d", children }) {
  return (
    <div style={{ background: "#16161e", borderRadius: 14, border: `1px solid ${accent}20`, marginBottom: 16, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px 10px", borderBottom: `1px solid #2a2a3a`, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 3, height: 16, background: accent, borderRadius: 2 }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e8ddd0" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: "#8888aa" }}>{subtitle}</div>}
        </div>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ background: "#1e1e2c", borderRadius: 10, padding: "14px", border: `1px solid ${color}20` }}>
      <div style={{ fontSize: 11, color: "#8888aa", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div style={{ textAlign: "center", padding: "20px 0", color: "#5a5a7a" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13 }}>{text}</div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#1a1a24", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480,
        maxHeight: "90vh", overflow: "auto", padding: 20, paddingBottom: 36,
        border: "1px solid #2a2a3a",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: "#2a2a3a", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", color: "#8888aa" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const labelStyle = { fontSize: 12, color: "#8888aa", display: "block", marginBottom: 5, fontWeight: 500 };

const inputStyle = {
  width: "100%", background: "#1e1e2c", border: "1px solid #3a3a50",
  borderRadius: 8, color: "#e8ddd0", padding: "10px 12px",
  fontSize: 14, boxSizing: "border-box",
};

const primaryBtn = {
  width: "100%", background: "linear-gradient(135deg, #e8b86d 0%, #d49a50 100%)",
  border: "none", borderRadius: 10, padding: "13px", fontSize: 15,
  fontWeight: 700, color: "#1a1208", cursor: "pointer", marginTop: 4,
};
