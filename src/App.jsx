import React, { useState, useEffect, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Search,
  Building2,
  Users,
  Key,
  Send,
  Sparkles,
  MessageSquare,
  HelpCircle,
  Check,
  RotateCcw,
  FileText,
  X,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Filter,
  DollarSign
} from 'lucide-react';

// Month ordering mapping
const MONTH_ORDER = {
  "1월": 1,
  "2월": 2,
  "3월": 3,
  "4월": 4,
  "5월": 5,
  "6월": 6
};

// Formatting Helper (Comma separator)
const formatNum = (num) => {
  return Math.round(num).toLocaleString('ko-KR');
};

const formatPercent = (val) => {
  if (isNaN(val) || !isFinite(val)) return '0.0';
  return val.toFixed(1);
};

export default function App() {
  // Theme State
  const [darkMode, setDarkMode] = useState(false);

  // Data States
  const [rawData, setRawData] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [errorData, setErrorData] = useState(null);

  // Filter States
  const [selectedMonths, setSelectedMonths] = useState(["1월", "2월", "3월", "4월", "5월", "6월"]);
  const [selectedDivision, setSelectedDivision] = useState("all"); // all, existing ('광고주'), new ('제안')
  const [deptSearch, setDeptSearch] = useState("");
  const [selectedDepts, setSelectedDepts] = useState([]);
  const [clientSearch, setClientSearch] = useState("");

  // Gemini API States
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [detectedModel, setDetectedModel] = useState({ modelName: 'gemini-1.5-flash', apiVersion: 'v1' });

  // Self-healing: Query available models for the user's API Key
  const discoverModel = async (key) => {
    if (!key) return;
    try {
      // Try v1 API
      let res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${key}`);
      let version = 'v1';
      if (!res.ok) {
        // Fallback to v1beta API
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        version = 'v1beta';
      }
      if (res.ok) {
        const data = await res.json();
        if (data.models && Array.isArray(data.models)) {
          const candidates = data.models.filter(m => 
            m.supportedGenerationMethods && 
            m.supportedGenerationMethods.includes('generateContent')
          );
          // Prioritize flash models, sorted descending (prefer 3.1, 2.5, 1.5, etc.)
          const flashCandidates = candidates.filter(m => m.name.toLowerCase().includes('flash'));
          if (flashCandidates.length > 0) {
            flashCandidates.sort((a, b) => b.name.localeCompare(a.name));
            const name = flashCandidates[0].name.replace('models/', '');
            setDetectedModel({ modelName: name, apiVersion: version });
            return;
          }
          if (candidates.length > 0) {
            const name = candidates[0].name.replace('models/', '');
            setDetectedModel({ modelName: name, apiVersion: version });
            return;
          }
        }
      }
    } catch (e) {
      console.warn("Gemini model discovery failed: ", e);
    }
    // Fallback default
    setDetectedModel({ modelName: 'gemini-1.5-flash', apiVersion: 'v1' });
  };

  // UI Interactive States
  const [activeTab, setActiveTab] = useState("dept"); // dept, clientSurplus, clientDeficit
  const [currentPage, setCurrentPage] = useState(1);
  const [comments, setComments] = useState({ kpi: "", trend: "", tower: "" });
  const [aiReports, setAiReports] = useState({ kpi: "", trend: "", tower: "" });
  const [loadingReports, setLoadingReports] = useState({ kpi: false, trend: false, tower: false });

  // Reset page when tab switches
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  // Chatbot States
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([
    {
      id: 1,
      sender: "ai",
      text: "안녕하세요. 광고 대행사 임원진을 위한 경영 실적 AI 도우미입니다. 현재 필터링된 대시보드 데이터를 기반으로 궁금하신 재무 현황을 질문해주시면 답변해 드리겠습니다. (예: '관리손익 적자가 가장 심한 광고주는 누구야?', '부서별 영업비용 순위는 어떻게 돼?')"
    }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Initialize: Load Theme & API Key from LocalStorage
  useEffect(() => {
    // Theme
    const isDark = localStorage.getItem('theme') === 'dark';
    setDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // API Key
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      setApiKey(savedKey);
      setApiKeySaved(true);
      discoverModel(savedKey);
    }

    // Load CSV Data
    fetchData();
  }, []);

  // Fetch and Parse CSV Data
  const fetchData = async () => {
    try {
      setLoadingData(true);
      const response = await fetch('/pl.csv');
      if (!response.ok) {
        throw new Error('CSV 파일을 불러오지 못했습니다. 경로를 확인해주세요.');
      }
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          // Parse values safely according to formulas
          const cleanData = results.data.map((row, idx) => {
            const totalSales = parseNumberValue(row['총매출']);
            const operatingRevenue = parseNumberValue(row['영업수익']);
            const operatingExpense = parseNumberValue(row['영업비용']);
            const laborCost = parseNumberValue(row['인건비']);

            // Rule-based metrics calculation
            const operatingProfit = operatingRevenue - operatingExpense;
            const managementPL = operatingProfit - laborCost;

            return {
              id: idx,
              month: (row['월'] || '').trim(),
              division: (row['구분'] || '').trim(), // '광고주' (기존 광고주), '제안' (신규 영업)
              department: (row['담당부서'] || '').trim(),
              clientName: (row['광고주명'] || '').trim(),
              code: (row['코드'] || '').trim(),
              totalSales,
              operatingRevenue,
              operatingExpense,
              operatingProfit,
              laborCost,
              managementPL
            };
          }).filter(row => row.month !== ""); // Filter invalid rows

          setRawData(cleanData);
          
          // Set initial departments checklist
          const depts = Array.from(new Set(cleanData.map(r => r.department))).filter(d => d !== "");
          setSelectedDepts(depts);
          
          setLoadingData(false);
        },
        error: (err) => {
          console.error(err);
          setErrorData('CSV 파싱 중 에러가 발생했습니다.');
          setLoadingData(false);
        }
      });
    } catch (err) {
      console.error(err);
      setErrorData(err.message);
      setLoadingData(false);
    }
  };

  // Helper: Remove commas and parse string to float
  const parseNumberValue = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const str = String(val).trim();
    if (str === '' || str === '-') return 0;
    const cleaned = str.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  // Toggle Theme
  const toggleTheme = () => {
    const nextDark = !darkMode;
    setDarkMode(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  // Save Gemini API Key
  const saveApiKey = async () => {
    localStorage.setItem('gemini_api_key', apiKey);
    setApiKeySaved(true);
    await discoverModel(apiKey);
    alert('Gemini API Key가 저장되었습니다. 모델 정보 자동 탐색을 완료했습니다!');
  };

  // Remove Gemini API Key
  const clearApiKey = () => {
    localStorage.removeItem('gemini_api_key');
    setApiKey("");
    setApiKeySaved(false);
    setDetectedModel({ modelName: 'gemini-1.5-flash', apiVersion: 'v1' });
  };

  // Unique lists from rawData for sidebar filters
  const allDepartments = useMemo(() => {
    return Array.from(new Set(rawData.map(r => r.department)))
      .filter(d => d !== "")
      .sort();
  }, [rawData]);

  const filteredDeptsList = useMemo(() => {
    if (!deptSearch) return allDepartments;
    return allDepartments.filter(d => d.toLowerCase().includes(deptSearch.toLowerCase()));
  }, [allDepartments, deptSearch]);

  // Master Data Filtering Logic
  const filteredData = useMemo(() => {
    return rawData.filter(row => {
      // 1. Month Filter
      if (!selectedMonths.includes(row.month)) return false;

      // 2. Division/Category Filter
      if (selectedDivision === "existing" && row.division !== "광고주") return false;
      if (selectedDivision === "new" && row.division !== "제안") return false;

      // 3. Department Filter
      if (!selectedDepts.includes(row.department)) return false;

      // 4. Client Search Filter
      if (clientSearch) {
        const query = clientSearch.toLowerCase();
        const clientFull = `${row.clientName}(${row.code})`.toLowerCase();
        if (!clientFull.includes(query)) return false;
      }

      return true;
    });
  }, [rawData, selectedMonths, selectedDivision, selectedDepts, clientSearch]);

  // Financial Metrics Computation for Filtered Data
  const summaryMetrics = useMemo(() => {
    let totalSales = 0;
    let operatingRevenue = 0;
    let operatingExpense = 0;
    let laborCost = 0;

    filteredData.forEach(row => {
      totalSales += row.totalSales;
      operatingRevenue += row.operatingRevenue;
      operatingExpense += row.operatingExpense;
      laborCost += row.laborCost;
    });

    const operatingProfit = operatingRevenue - operatingExpense;
    const managementPL = operatingProfit - laborCost;

    return {
      totalSales,
      operatingRevenue,
      operatingExpense,
      operatingProfit,
      laborCost,
      managementPL
    };
  }, [filteredData]);

  // MoM Growth Rate Calculation
  // We compare the selected months' performance against the performance of the matching shifted prior months.
  const momGrowth = useMemo(() => {
    if (selectedMonths.length === 0 || rawData.length === 0) {
      return { totalSales: 0, operatingRevenue: 0, operatingProfit: 0, managementPL: 0, priorMonths: [] };
    }

    const selectedNums = selectedMonths.map(m => MONTH_ORDER[m]).filter(Boolean);
    const minSelected = Math.min(...selectedNums);
    const maxSelected = Math.max(...selectedNums);
    const N = selectedMonths.length;

    // Shift back to find prior period months
    // e.g. for [4, 5, 6] of size 3, prior is [1, 2, 3]
    const priorNums = selectedNums.map(n => n - N).filter(n => n >= 1 && n <= 6);

    if (priorNums.length === 0) {
      return { totalSales: null, operatingRevenue: null, operatingProfit: null, managementPL: null, priorMonths: [] };
    }

    const priorMonthsStr = Object.keys(MONTH_ORDER).filter(m => priorNums.includes(MONTH_ORDER[m]));

    // Calculate prior period sum
    let priorSales = 0;
    let priorRevenue = 0;
    let priorExpense = 0;
    let priorLabor = 0;

    rawData.forEach(row => {
      // Must also match other filters (division, department, client) to make it a fair MoM comparison
      if (selectedDivision === "existing" && row.division !== "광고주") return;
      if (selectedDivision === "new" && row.division !== "제안") return;
      if (!selectedDepts.includes(row.department)) return;
      if (clientSearch) {
        const query = clientSearch.toLowerCase();
        const clientFull = `${row.clientName}(${row.code})`.toLowerCase();
        if (!clientFull.includes(query)) return;
      }

      if (priorMonthsStr.includes(row.month)) {
        priorSales += row.totalSales;
        priorRevenue += row.operatingRevenue;
        priorExpense += row.operatingExpense;
        priorLabor += row.laborCost;
      }
    });

    const priorProfit = priorRevenue - priorExpense;
    const priorPL = priorProfit - priorLabor;

    const calcGrowth = (curr, prior) => {
      if (prior === null || prior === undefined || prior === 0) return null;
      // Formula handles signs correctly (e.g. if prior was negative and current is positive/less negative)
      // Standard growth rate formula: ((Current - Prior) / Math.abs(Prior)) * 100
      return ((curr - prior) / Math.abs(prior)) * 100;
    };

    return {
      totalSales: calcGrowth(summaryMetrics.totalSales, priorSales),
      operatingRevenue: calcGrowth(summaryMetrics.operatingRevenue, priorRevenue),
      operatingProfit: calcGrowth(summaryMetrics.operatingProfit, priorProfit),
      managementPL: calcGrowth(summaryMetrics.managementPL, priorPL),
      priorMonths: priorMonthsStr
    };
  }, [selectedMonths, rawData, selectedDivision, selectedDepts, clientSearch, summaryMetrics]);

  // Monthly breakdown for Recharts trend visualization
  const trendData = useMemo(() => {
    const months = ["1월", "2월", "3월", "4월", "5월", "6월"].filter(m => selectedMonths.includes(m));
    return months.map(m => {
      let sales = 0;
      let rev = 0;
      let exp = 0;
      let labor = 0;

      filteredData.forEach(row => {
        if (row.month === m) {
          sales += row.totalSales;
          rev += row.operatingRevenue;
          exp += row.operatingExpense;
          labor += row.laborCost;
        }
      });

      const profit = rev - exp;
      const pl = profit - labor;

      return {
        name: m,
        "총매출": sales,
        "영업수익": rev,
        "영업실적": profit,
        "관리손익": pl,
        "영업비용": exp,
        "인건비": labor
      };
    });
  }, [filteredData, selectedMonths]);

  // Top/Bottom Table Calculations (Performance Tower)
  const towerData = useMemo(() => {
    // 1. Department management PL list
    const deptMap = {};
    filteredData.forEach(row => {
      if (!deptMap[row.department]) {
        deptMap[row.department] = { department: row.department, sales: 0, revenue: 0, expense: 0, labor: 0 };
      }
      deptMap[row.department].sales += row.totalSales;
      deptMap[row.department].revenue += row.operatingRevenue;
      deptMap[row.department].expense += row.operatingExpense;
      deptMap[row.department].labor += row.laborCost;
    });

    const deptList = Object.values(deptMap).map(d => {
      const profit = d.revenue - d.expense;
      const pl = profit - d.labor;
      return {
        name: d.department,
        sales: d.sales,
        revenue: d.revenue,
        expense: d.expense,
        labor: d.labor,
        profit,
        managementPL: pl
      };
    }).sort((a, b) => b.managementPL - a.managementPL);

    // 2. Client management PL list
    const clientMap = {};
    filteredData.forEach(row => {
      if (row.division === "제안") return; // Exclude proposal advertisers from clients surplus/deficit
      // Key contains name + code
      const key = `${row.clientName}(${row.code})`;
      if (!clientMap[key]) {
        clientMap[key] = { key, clientName: row.clientName, code: row.code, sales: 0, revenue: 0, expense: 0, labor: 0 };
      }
      clientMap[key].sales += row.totalSales;
      clientMap[key].revenue += row.operatingRevenue;
      clientMap[key].expense += row.operatingExpense;
      clientMap[key].labor += row.laborCost;
    });

    const clientList = Object.values(clientMap).map(c => {
      const profit = c.revenue - c.expense;
      const pl = profit - c.labor;
      return {
        // Required format: "광고주명(코드)"
        name: `${c.clientName}(${c.code})`,
        sales: c.sales,
        revenue: c.revenue,
        expense: c.expense,
        labor: c.labor,
        profit,
        managementPL: pl
      };
    });

    const clientSurplusList = [...clientList].sort((a, b) => b.managementPL - a.managementPL);
    const clientDeficitList = [...clientList].sort((a, b) => a.managementPL - b.managementPL);

    return {
      depts: deptList,
      clientSurplus: clientSurplusList,
      clientDeficit: clientDeficitList
    };
  }, [filteredData]);

  // QUANTITATIVE COMMENTARY GENERATION (Rule-based)
  const showCommentary = (sectionId) => {
    let commentText = "";
    if (sectionId === 'kpi') {
      const margin = summaryMetrics.operatingRevenue > 0 ? (summaryMetrics.managementPL / summaryMetrics.operatingRevenue) * 100 : 0;
      const laborRatio = summaryMetrics.operatingProfit > 0 ? (summaryMetrics.laborCost / summaryMetrics.operatingProfit) * 100 : 0;
      commentText = `선택된 기간의 총매출(광고취급액)은 ${formatNum(summaryMetrics.totalSales)}원이며, 이 중 실제 영업수익은 ${formatNum(summaryMetrics.operatingRevenue)}원(회수율 ${formatPercent((summaryMetrics.operatingRevenue / summaryMetrics.totalSales) * 100)}%)을 기록했습니다. 영업비용을 제외한 영업실적은 ${formatNum(summaryMetrics.operatingProfit)}원이며, 인건비 ${formatNum(summaryMetrics.laborCost)}원(영업실적 대비 ${formatPercent(laborRatio)}%)을 집행한 결과, 최종 관리손익은 ${formatNum(summaryMetrics.managementPL)}원(영업수익 대비 최종 마진율 ${formatPercent(margin)}%)입니다.`;
    } else if (sectionId === 'trend') {
      if (trendData.length === 0) {
        commentText = "선택된 조건의 트렌드 데이터가 존재하지 않습니다.";
      } else {
        const sortedByPL = [...trendData].sort((a, b) => b.관리손익 - a.관리손익);
        const bestMonth = sortedByPL[0];
        const worstMonth = sortedByPL[sortedByPL.length - 1];
        commentText = `분석 결과, 관리손익이 가장 높은 달은 ${bestMonth.name} (${formatNum(bestMonth.관리손익)}원)이었으며, 가장 실적이 부진한 달은 ${worstMonth.name} (${formatNum(worstMonth.관리손익)}원)으로 집계되었습니다. 해당 기간 동안 영업수익 대비 관리손익의 추이는 ${trendData[trendData.length - 1].관리손익 > trendData[0].관리손익 ? '점진적 상승' : '하향 조정'} 흐름을 보이고 있어, 비용 관리의 기민성이 요구됩니다.`;
      }
    } else if (sectionId === 'tower') {
      const topDept = towerData.depts[0];
      const topClient = towerData.clientSurplus[0];
      const worstClient = towerData.clientDeficit[0];
      commentText = `실적 타워 분석 결과, 광고본부 부서 중 관리손익 기준 최고 기여 부서는 [${topDept ? topDept.name : 'N/A'}] (${topDept ? formatNum(topDept.managementPL) : 0}원) 입니다. 한편, 흑자 기여도가 가장 큰 광고주는 [${topClient ? topClient.name : 'N/A'}] (${topClient ? formatNum(topClient.managementPL) : 0}원)이며, 적자 폭이 가장 커 경영 보완이 시급한 광고주는 [${worstClient ? worstClient.name : 'N/A'}] (${worstClient ? formatNum(worstClient.managementPL) : 0}원)인 것으로 드러났습니다.`;
    }

    setComments(prev => ({ ...prev, [sectionId]: commentText }));
  };

  const closeComment = (sectionId) => {
    setComments(prev => ({ ...prev, [sectionId]: "" }));
  };

  // GEMINI AI INTEGRATED ANALYSIS (Fetch to Google API or Mock Fallback)
  const generateAiAnalysis = async (sectionId) => {
    setAiReports(prev => ({ ...prev, [sectionId]: "" }));
    setLoadingReports(prev => ({ ...prev, [sectionId]: true }));

    // Prepare Prompt based on data
    let prompt = "";
    if (sectionId === 'kpi') {
      prompt = `
      귀하는 전문 광고 대행사의 최고재무책임자(CFO)입니다. 다음은 선택된 필터 기준의 재무 지표 요약본입니다.
      - 총매출: ${formatNum(summaryMetrics.totalSales)}원
      - 영업수익: ${formatNum(summaryMetrics.operatingRevenue)}원
      - 영업실적(영업수익 - 영업비용): ${formatNum(summaryMetrics.operatingProfit)}원
      - 인건비: ${formatNum(summaryMetrics.laborCost)}원
      - 관리손익(영업실적 - 인건비): ${formatNum(summaryMetrics.managementPL)}원
      
      이 지표를 정밀하게 분석하여:
      1. 광고취급액(총매출) 대비 영업수익 전환율 및 영업수익 대비 인건비 비중의 적정성 평가.
      2. 디지털 대행사 입장에서 본 재무 구조 상의 핵심 위험 요인 2가지.
      3. 수익성과 관리손익(최종 영업이익) 극대화를 위한 CFO 관점의 단기 및 장기 실행 로드맵 3가지.
      
      답변은 임원 보고용 형식을 갖추어 한글로 명확하고 설득력 있게 작성해주세요. 수치 데이터를 근거로 활용하십시오.
      `;
    } else if (sectionId === 'trend') {
      const dataStr = trendData.map(t => `${t.name}(수익:${formatNum(t.영업수익)}원, 실적:${formatNum(t.영업실적)}원, 인건비:${formatNum(t.인건비)}원, 관리손익:${formatNum(t.관리손익)}원)`).join(', ');
      prompt = `
      귀하는 광고 대행사의 재무 컨설턴트입니다. 다음은 선택된 필터에 따른 월별 경영 추이 데이터입니다.
      데이터: ${dataStr}
      
      이 데이터를 시계열 관점에서 분석하여 다음 질문에 답하세요:
      1. 상반기 내 영업수익 대비 인건비 및 영업비용의 변동 추이 요약 (어떤 달에 비용 왜곡이나 실적 급락/급등이 나타나는지 분석).
      2. 관리손익이 급격히 저하된 시점의 유력한 외부/내부 원인 추정 및 코멘트.
      3. 급격한 성수기/비성수기 변동성에 대응하기 위해 인건비 및 외주 비용을 유연화할 수 있는 재무 구조 안정화 방안.
      
      답변은 보고서 스타일로 한글로 개조식으로 일목요연하게 분석해주세요.
      `;
    } else if (sectionId === 'tower') {
      const topDeptsStr = towerData.depts.map((d, i) => `${i+1}. ${d.name}(${formatNum(d.managementPL)}원)`).join('\n');
      const topClientsStr = towerData.clientSurplus.map((c, i) => `${i+1}. ${c.name}(${formatNum(c.managementPL)}원)`).join('\n');
      const worstClientsStr = towerData.clientDeficit.map((c, i) => `${i+1}. ${c.name}(${formatNum(c.managementPL)}원)`).join('\n');
      
      prompt = `
      귀하는 광고 대행사의 영업 포트폴리오 기획팀장입니다. 아래의 부서 및 광고주 실적 데이터를 분석하십시오.
      
      [부서 실적 Top 10 (관리손익 기준)]
      ${topDeptsStr}
      
      [광고주 흑자 기여 Top 10 (관리손익 기준)]
      ${topClientsStr}
      
      [광고주 적자 규모 Top 10 (관리손익 기준)]
      ${worstClientsStr}
      
      이 조직 성과를 바탕으로 다음을 작성해주세요:
      1. 실적 부진 부서와 적자 광고주 집단 간의 유기적 상관관계 및 비효율 요인 분석.
      2. 적자 광고주(Deficit Clients)에 대한 현실적인 손실 축소 대책 (예: 요율 현실화, 투입 공수(인건비) 통제, 제안 축소 등).
      3. 우수 광고주(Surplus Clients)의 추가 예산 유도 및 서비스 락인(Lock-in) 전략.
      
      답변은 즉각 기획안에 적용할 수 있을 정도로 상세하고 전문적인 비즈니스 톤앤매너로 작성해주세요.
      `;
    }

    try {
      if (apiKeySaved && apiKey) {
        const resultText = await callGeminiAPI(apiKey, prompt);
        setAiReports(prev => ({ ...prev, [sectionId]: resultText }));
      } else {
        // Fallback Mock Response (High Quality)
        await new Promise(resolve => setTimeout(resolve, 1500)); // Loading effect
        const mockResponse = getMockAiResponse(sectionId);
        setAiReports(prev => ({ ...prev, [sectionId]: mockResponse }));
      }
    } catch (err) {
      console.error(err);
      setAiReports(prev => ({ ...prev, [sectionId]: `오류가 발생했습니다: ${err.message}\nAPI 키 상태를 확인하시고 다시 시도해 주세요.` }));
    } finally {
      setLoadingReports(prev => ({ ...prev, [sectionId]: false }));
    }
  };

  const closeAiReport = (sectionId) => {
    setAiReports(prev => ({ ...prev, [sectionId]: "" }));
  };

  // Chatbot logic
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { id: Date.now(), sender: "user", text: userMsg }]);
    setChatLoading(true);

    // Build chatbot context
    const currentContext = `
    대시보드 상태 데이터:
    - 현재 선택 월: ${selectedMonths.join(', ')}
    - 선택 구분: ${selectedDivision === 'all' ? '전체' : selectedDivision === 'existing' ? '기존 광고주(광고주)' : '신규 영업(제안)'}
    - 전체 실적 요약: 총매출 ${formatNum(summaryMetrics.totalSales)}원, 영업수익 ${formatNum(summaryMetrics.operatingRevenue)}원, 영업실적 ${formatNum(summaryMetrics.operatingProfit)}원, 인건비 ${formatNum(summaryMetrics.laborCost)}원, 관리손익 ${formatNum(summaryMetrics.managementPL)}원.
    - 부서 관리손익 순위: ${towerData.depts.map(d => `${d.name}: ${formatNum(d.managementPL)}원`).join(', ')}
    - 흑자 광고주 Top 3: ${towerData.clientSurplus.slice(0, 3).map(c => `${c.name}: ${formatNum(c.managementPL)}원`).join(', ')}
    - 적자 광고주 Top 3: ${towerData.clientDeficit.slice(0, 3).map(c => `${c.name}: ${formatNum(c.managementPL)}원`).join(', ')}
    `;

    const chatHistoryPrompt = chatMessages.slice(-5).map(m => `${m.sender === 'user' ? '질문' : '답변'}: ${m.text}`).join('\n');

    const prompt = `
    귀하는 광고 대행사의 경영진을 위한 실시간 금융 비서 및 전문 비즈니스 분석가입니다.
    현재 대시보드의 데이터 정보는 다음과 같습니다:
    ${currentContext}
    
    이전 대화 내역:
    ${chatHistoryPrompt}
    
    사용자의 새로운 질문: "${userMsg}"
    
    위 데이터를 활용하여 사용자의 질문에 정확하고 구체적인 한글 수치 정보를 포함해 답장해주세요.
    만약 질문이 대시보드 데이터 외적인 내용이라면 비즈니스 컨설턴트 관점에서 일반적인 해결책을 제안하고 데이터와의 연관성을 설명해주세요.
    `;

    try {
      if (apiKeySaved && apiKey) {
        const aiText = await callGeminiAPI(apiKey, prompt);
        setChatMessages(prev => [...prev, { id: Date.now() + 1, sender: "ai", text: aiText }]);
      } else {
        // Call local chatbot keywords logic
        await new Promise(resolve => setTimeout(resolve, 1200));
        const aiText = getMockChatResponse(userMsg);
        setChatMessages(prev => [...prev, { id: Date.now() + 1, sender: "ai", text: aiText }]);
      }
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { id: Date.now() + 1, sender: "ai", text: `오류가 발생했습니다: ${err.message}. API 키나 네트워크 상태를 확인해주세요.` }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Scroll Chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  // REST API Call helper
  const callGeminiAPI = async (key, promptText) => {
    const url = `https://generativelanguage.googleapis.com/${detectedModel.apiVersion}/models/${detectedModel.modelName}:generateContent?key=${key}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: promptText }]
          }
        ]
      })
    });

    if (!response.ok) {
      const errRes = await response.json();
      throw new Error(errRes.error?.message || 'Gemini API 호출 중 원인을 알 수 없는 에러가 발생했습니다.');
    }

    const resJson = await response.json();
    return resJson.candidates[0].content.parts[0].text;
  };

  // Mock Gemini responses generator for key screens
  const getMockAiResponse = (sectionId) => {
    const defaultNotice = "\n\n*(※ 알림: 이 리포트는 Gemini API Key 미지정 상태에 따라 로컬 브라우저 필터 데이터를 근거로 시뮬레이션된 Mock AI 리포트입니다.)*";
    
    if (sectionId === 'kpi') {
      const sales = formatNum(summaryMetrics.totalSales);
      const rev = formatNum(summaryMetrics.operatingRevenue);
      const profit = formatNum(summaryMetrics.operatingProfit);
      const labor = formatNum(summaryMetrics.laborCost);
      const pl = formatNum(summaryMetrics.managementPL);
      const laborRatio = summaryMetrics.operatingProfit > 0 ? formatPercent((summaryMetrics.laborCost / summaryMetrics.operatingProfit) * 100) : '0';
      const margin = summaryMetrics.operatingRevenue > 0 ? formatPercent((summaryMetrics.managementPL / summaryMetrics.operatingRevenue) * 100) : '0';

      return `### 📋 CFO 경영 실적 핵심 진단 보고서

**1. 재무 안정성 요약 평가**
- 현재 선택 필터링 기준 전사 총매출(광고취급액)은 **${sales}원**이며, 최종 관리손익은 **${pl}원**입니다.
- 영업수익 대비 최종 관리손익율(마진율)은 **${margin}%**로 동종업계 평균(7.5%) 대비 ${parseFloat(margin) >= 7.5 ? '양호한' : '개선이 요구되는'} 상태입니다.
- 영업실적 대비 인건비 비중은 **${laborRatio}%**로 집계되어 고정성 인력 투자 효율을 추가 점검할 필요가 있습니다.

**2. 주요 재무 위험 요인**
- **과도한 인적 레버리지 리스크**: 영업 수익성이 떨어질 때도 인건비성 지출(${labor}원)은 고정비로 지출되어, 하방 경직성을 유발하고 관리손익 적자 광고주 증가의 주 원인이 됩니다.
- **취급액 대비 저조한 실제 수익률**: 매체 대행 비중이 큰 광고주의 경우 총매출 대비 영업수익률이 낮아 외형 성장에 비해 실질 이익이 제한적일 우려가 있습니다.

**3. 단기 및 장기 개선 전략**
- **[단기] 공수(인건비) 통제 장치 마련**: 부서별 실적 타워를 기반으로 관리손익 적자 기여도가 큰 하위 광고주들에게 불필요하게 투입되는 기획/운영 리소스를 통제하고, 외주 대행비 정산 기준을 재수립해야 합니다.
- **[단기] 단가 및 계약 조건 리비전**: 마진율이 마이너스인 광고주 리스트를 검출하여 3분기 재계약 시 대행 수수료율 인상(최소 2~3%p)을 요구하거나 부가서비스를 유료화합니다.
- **[장기] 사업 다변화**: 고마진의 크리에이티브 제작 및 브랜드 컨설팅 비중을 높여 인건비 투입량 대비 영업수익 효율성을 배가시키는 고부가가치 모델로의 전환을 제안합니다.${defaultNotice}`;
    } else if (sectionId === 'trend') {
      const sortedTrend = [...trendData].sort((a, b) => b.관리손익 - a.관리손익);
      const peak = sortedTrend[0] ? sortedTrend[0].name : "1월";
      const trough = sortedTrend[sortedTrend.length - 1] ? sortedTrend[sortedTrend.length - 1].name : "6월";
      
      return `### 📈 시계열 경영 실적 분석 리포트

**1. 월별 흐름 진단**
- 전체 상반기 중 관리손익 정점(Peak)은 **${peak}**이며, 저점(Trough)은 **${trough}**로 분석됩니다.
- 영업비용 및 인건비가 매출 변화에 맞춰 유동적으로 연동되고 있는지 확인해본 결과, 광고 수주 성수기에 인건비가 비례하여 상승한 뒤 비성수기 시점에도 동일 수준으로 고착화되는 **비용 하방 경직성**이 나타나고 있습니다.

**2. 변동성 왜곡 시점 원인 추정**
- 특정 월에 총매출 급증에도 불구, 관리손익이 되려 감소하는 양상은 주로 신규 비딩(제안) 수주를 위한 비용 선집행 또는 일시적인 성과급 지급, 외주 기획료의 정산 지연에 기인한 것으로 파악됩니다.
- 부서별 인력 배분 주기가 실시간 광고주 유치 변동성에 1~2개월 후행하여 관리 비용 미스매치를 키우고 있습니다.

**3. 비즈니스 체질 개선안**
- **인력 구조 유연성 제고**: 핵심 PM급은 정규 인력으로 유지하되 실무 운영진은 성수기 변동성에 맞게 프리랜서 및 파트너사 네트워크 풀을 상시 확보하여 고정 인건비를 가변 비용화합니다.
- **조기 경보 지표 수립**: 월별 영업수익 대비 영업비용 비중이 25%를 초과할 시 부서장 승인 하에 예산을 집행하는 '재무 조기경보제(Red Flag)' 제도를 선제 도입할 것을 제안합니다.${defaultNotice}`;
    } else if (sectionId === 'tower') {
      const topDept = towerData.depts[0] ? towerData.depts[0].name : "광고사업본부";
      const worstClient = towerData.clientDeficit[0] ? towerData.clientDeficit[0].name : "미지정";
      const surplusCount = towerData.clientSurplus.length;

      return `### 🗼 조직 부서 및 포트폴리오 개선 기획서

**1. 부서 성과 격차 원인 진단**
- 최고 성과 부서인 **${topDept}**의 경우, 흑자 기여도가 큰 우수 광고주 포트폴리오를 보유하고 있으며 인당 영업수익(생산성)이 타 부서 대비 높은 수준을 유지하고 있습니다.
- 반면, 하위 적자 부서는 제안 영업 단계의 리소스를 과도하게 소모하거나, 초기 런칭을 위한 비용 지출 대비 기성 수수료 회수가 지연되고 있습니다.

**2. 적자 광고주 관리 강화 방안 (Target: ${worstClient} 등)**
- **투입 공수 제한(Resource Cap)**: 적자가 발생하는 광고주에는 주간 기획 회의 및 리포팅 주기를 조절하여 담당 인력(AE, 디자이너)의 작업 시간 투입을 25% 감축합니다.
- **수익성 중심 평가 체계 도입**: 부서 평가 시 외형 매출(광고취급액)이 아닌 '최종 관리손익' 기여도를 50% 이상 반영하도록 KPI 제도를 개편하여 영업본부 스스로가 역마진 광고주를 스크리닝하도록 유도합니다.

**3. 우수 고객 Lock-in 및 예산 극대화**
- 관리손익 기여 상위 광고주들을 대상으로 분기별 단독 마케팅 컨설팅 세션을 추가 무상 제공하여 관계성을 락인하는 한편, 신매체(인플루언서 마케팅, 리테일 미디어 등) 제안을 확대하여 영업수익률을 추가 확보합니다.${defaultNotice}`;
    }
    return "";
  };

  // Local Mock chatbot keyword matching replies
  const getMockChatResponse = (query) => {
    const q = query.toLowerCase();
    const sales = formatNum(summaryMetrics.totalSales);
    const rev = formatNum(summaryMetrics.operatingRevenue);
    const profit = formatNum(summaryMetrics.operatingProfit);
    const labor = formatNum(summaryMetrics.laborCost);
    const pl = formatNum(summaryMetrics.managementPL);

    // 1. Check for worst clients / deficit clients
    if (q.includes("적자") || q.includes("손실") || q.includes("부진")) {
      const worst = towerData.clientDeficit.slice(0, 3);
      if (worst.length === 0) return "현재 조건으로 조회된 광고주 데이터가 없습니다.";
      return `현재 필터링된 조건 기준으로 관리손익 적자가 가장 심한 광고주 Top 3는 다음과 같습니다:

1. **${worst[0].name}**: 관리손익 **${formatNum(worst[0].managementPL)}원** (영업수익: ${formatNum(worst[0].revenue)}원 / 인건비: ${formatNum(worst[0].labor)}원)
2. **${worst[1] ? worst[1].name : 'N/A'}**: 관리손익 **${worst[1] ? formatNum(worst[1].managementPL) : 0}원**
3. **${worst[2] ? worst[2].name : 'N/A'}**: 관리손익 **${worst[2] ? formatNum(worst[2].managementPL) : 0}원**

**진단:** 이들 광고주의 공통점은 영업수익 대비 전담 AE 및 제작 인력의 인건비 배정액이 높게 집행되고 있어 역마진이 심화되고 있다는 점입니다. 투입 인력 조정이나 수수료 요율 인상이 긴급합니다.`;
    }

    // 2. Check for best departments / division costs
    if (q.includes("부서") || q.includes("팀") || q.includes("영업비용")) {
      const depts = [...towerData.depts].sort((a, b) => b.expense - a.expense);
      if (depts.length === 0) return "현재 조건으로 조회된 부서 데이터가 없습니다.";
      return `현재 선택된 기간과 필터 기준, **영업비용이 가장 많이 발생한 부서**는 **${depts[0].name}** (${formatNum(depts[0].expense)}원) 입니다. 

**부서별 영업비용 순위:**
1. **${depts[0].name}**: 영업비용 ${formatNum(depts[0].expense)}원 (관리손익: ${formatNum(depts[0].managementPL)}원)
2. **${depts[1] ? depts[1].name : 'N/A'}**: 영업비용 ${depts[1] ? formatNum(depts[1].expense) : 0}원 (관리손익: ${depts[1] ? formatNum(depts[1].managementPL) : 0}원)
3. **${depts[2] ? depts[2].name : 'N/A'}**: 영업비용 ${depts[2] ? formatNum(depts[2].expense) : 0}원 (관리손익: ${depts[2] ? formatNum(depts[2].managementPL) : 0}원)

**코멘트:** 영업비용 규모와 관리손익이 정비례하지 않는 부서(비용은 높은데 이익이 적은 부서)의 경우 매체 실행 과정에서의 수수료 마진율을 재분석할 필요가 있습니다.`;
    }

    // 3. New business (제안) conversion rate
    if (q.includes("신규") || q.includes("제안") || q.includes("전환율")) {
      // Calculate '제안' (new) vs '광고주' (existing) conversion/profitability
      let newSales = 0, newRev = 0, newExp = 0, newLabor = 0;
      let extSales = 0, extRev = 0, extExp = 0, extLabor = 0;

      rawData.forEach(row => {
        if (selectedMonths.includes(row.month)) {
          if (row.division === "제안") {
            newSales += row.totalSales;
            newRev += row.operatingRevenue;
            newExp += row.operatingExpense;
            newLabor += row.laborCost;
          } else {
            extSales += row.totalSales;
            extRev += row.operatingRevenue;
            extExp += row.operatingExpense;
            extLabor += row.laborCost;
          }
        }
      });

      const newPL = newRev - newExp - newLabor;
      const extPL = extRev - extExp - extLabor;

      const newMargin = newSales > 0 ? (newRev / newSales) * 100 : 0;
      const extMargin = extSales > 0 ? (extRev / extSales) * 100 : 0;

      return `상반기 **신규 영업(구분: 제안)**과 **기존 광고주(구분: 광고주)**의 수익 지표 및 전환 효율 비교 데이터입니다.

- **신규 영업 (제안)**
  * 총매출: ${formatNum(newSales)}원
  * 영업수익: ${formatNum(newRev)}원 (총매출 대비 수익률: **${formatPercent(newMargin)}%**)
  * 최종 관리손익: ${formatNum(newPL)}원

- **기존 광고주 (광고주)**
  * 총매출: ${formatNum(extSales)}원
  * 영업수익: ${formatNum(extRev)}원 (총매출 대비 수익률: **${formatPercent(extMargin)}%**)
  * 최종 관리손익: ${formatNum(extPL)}원

**분석 결과:** 신규 영업의 경우 영업수익 전환율은 ${formatPercent(newMargin)}%로 기존 광고주(${formatPercent(extMargin)}%)에 비해 ${parseFloat(newMargin) >= parseFloat(extMargin) ? '우수한' : '낮은'} 흐름을 보입니다. 다만 제안 단계의 인건비 투입이 조기 집행되므로 단기적으로는 부서 관리손익 압박 요인이 될 수 있어 적정 비딩비용 제한 장치가 요구됩니다.`;
    }

    // 4. Fallback default reply
    return `대시보드 데이터분석 도우미입니다. 질문하신 내용 "${query}"과 관련하여 실질 재무 수치 분석 결과는 다음과 같습니다:

- 선택된 조건 하 전사 총매출: **${sales}원**
- 영업수익: **${rev}원**
- 최종 관리손익: **${pl}원**

*(※ 상세한 자연어 질문 답변을 활용하시려면 좌측 최하단에 Gemini API Key를 저장해 주십시오. 실시간 데이터를 반영해 더 지능적인 심층 답변을 작성해 드립니다.)*`;
  };

  // Helper to select all or clear months
  const toggleAllMonths = (select) => {
    if (select) {
      setSelectedMonths(["1월", "2월", "3월", "4월", "5월", "6월"]);
    } else {
      setSelectedMonths([]);
    }
  };

  // Helper to select all or clear depts
  const toggleAllDepts = (select) => {
    if (select) {
      setSelectedDepts(allDepartments);
    } else {
      setSelectedDepts([]);
    }
  };

  const handleDeptCheckbox = (dept) => {
    if (selectedDepts.includes(dept)) {
      setSelectedDepts(prev => prev.filter(d => d !== dept));
    } else {
      setSelectedDepts(prev => [...prev, dept]);
    }
  };

  // Pagination logic for Performance Tower
  const ITEMS_PER_PAGE = 10;
  const activeList = useMemo(() => {
    if (activeTab === 'dept') return towerData.depts;
    if (activeTab === 'clientSurplus') return towerData.clientSurplus;
    return towerData.clientDeficit;
  }, [towerData, activeTab]);

  const totalPages = Math.max(1, Math.ceil(activeList.length / ITEMS_PER_PAGE));

  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return activeList.slice(start, start + ITEMS_PER_PAGE);
  }, [activeList, currentPage]);

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 transition-colors duration-300 font-sans">
      
      {/* Top Header Row */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] z-20">
        <div className="flex items-center gap-2.5">
          <div className="bg-blue-600 text-white p-2 rounded-lg flex items-center justify-center">
            <DollarSign size={20} className="stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              관리손익(P&L) 분석 대시보드
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                Executive
              </span>
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">디지털 광고 대행사 임원 경영 분석 포털</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Mock Status Badge */}
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
            <span className={`h-1.5 w-1.5 rounded-full ${apiKeySaved ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            {apiKeySaved ? 'Gemini AI 연동됨' : 'Mock 모드 실행 중'}
          </div>

          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
            title={darkMode ? "라이트 모드로 변경" : "다크 모드로 변경"}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      {/* Main Body Grid: 3 Column Layout (20% - 55% - 25%) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        
        {/* ========================================================
            1. LEFT PANEL: MENU & FILTERS (20% -> lg:col-span-3 또는 col-span-2)
            ======================================================== */}
        <aside className="lg:col-span-3 xl:col-span-2 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] flex flex-col h-full overflow-y-auto min-h-[calc(100vh-73px)] justify-between">
          
          <div className="p-4 space-y-6">
            
            {/* Filter Section Header */}
            <div className="flex items-center gap-1.5 border-b border-zinc-100 dark:border-zinc-800/60 pb-2 text-zinc-500 dark:text-zinc-400">
              <Filter size={16} />
              <h2 className="text-xs font-semibold uppercase tracking-wider">상세 조건 필터</h2>
            </div>

            {/* 1. Month Filter */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">월별 선택</label>
                <div className="flex gap-1.5 text-[10px]">
                  <button 
                    onClick={() => toggleAllMonths(true)} 
                    className="text-blue-500 hover:underline"
                  >
                    전체
                  </button>
                  <span className="text-zinc-300 dark:text-zinc-700">|</span>
                  <button 
                    onClick={() => toggleAllMonths(false)} 
                    className="text-zinc-400 hover:underline"
                  >
                    해제
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {["1월", "2월", "3월", "4월", "5월", "6월"].map(m => {
                  const isChecked = selectedMonths.includes(m);
                  return (
                    <button
                      key={m}
                      onClick={() => {
                        if (isChecked) {
                          setSelectedMonths(prev => prev.filter(x => x !== m));
                        } else {
                          setSelectedMonths(prev => [...prev, m]);
                        }
                      }}
                      className={`py-1.5 px-2 text-xs font-medium rounded-md border text-center transition-all ${
                        isChecked 
                          ? 'bg-blue-500/10 text-blue-600 border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30' 
                          : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Division/Category Filter */}
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">구분 필터</label>
              <div className="bg-zinc-100 dark:bg-zinc-900/60 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800/80 grid grid-cols-3 gap-1">
                {[
                  { value: "all", label: "전체" },
                  { value: "existing", label: "기존" },
                  { value: "new", label: "신규" }
                ].map(item => (
                  <button
                    key={item.value}
                    onClick={() => setSelectedDivision(item.value)}
                    className={`py-1 px-1.5 text-center text-xs font-medium rounded-md transition-all ${
                      selectedDivision === item.value
                        ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Department Search & Checkboxes */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">부서별 필터 ({selectedDepts.length})</label>
                <div className="flex gap-1.5 text-[10px]">
                  <button onClick={() => toggleAllDepts(true)} className="text-blue-500 hover:underline">전체</button>
                  <span className="text-zinc-300 dark:text-zinc-700">|</span>
                  <button onClick={() => toggleAllDepts(false)} className="text-zinc-400 hover:underline">해제</button>
                </div>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-400" />
                <input
                  type="text"
                  placeholder="부서명 검색..."
                  value={deptSearch}
                  onChange={(e) => setDeptSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-800 rounded-md bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
              </div>
              <div className="max-h-40 overflow-y-auto border border-zinc-200 dark:border-zinc-800/80 rounded-md p-2 space-y-1.5 bg-zinc-50/50 dark:bg-zinc-950/40">
                {filteredDeptsList.length === 0 ? (
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-600 text-center py-2">검색 결과가 없습니다.</p>
                ) : (
                  filteredDeptsList.map(dept => {
                    const isChecked = selectedDepts.includes(dept);
                    return (
                      <label key={dept} className="flex items-center gap-2 cursor-pointer text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleDeptCheckbox(dept)}
                          className="rounded text-blue-600 focus:ring-blue-500 border-zinc-300 dark:border-zinc-800 bg-transparent h-3.5 w-3.5"
                        />
                        <span className="text-[11px] truncate" title={dept}>{dept}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* 4. Client Search Filter */}
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">광고주명 검색</label>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-400" />
                <input
                  type="text"
                  placeholder="광고주명 또는 코드..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-800 rounded-md bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
              </div>
            </div>

          </div>

          {/* Bottom fixed Gemini API Key block */}
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 space-y-2.5">
            <div className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
              <Key size={14} className="text-blue-500" />
              <label className="text-xs font-bold">Gemini API Key 설정</label>
            </div>
            
            <div className="space-y-2">
              <input
                type="password"
                placeholder={apiKeySaved ? "••••••••••••••••••••••••" : "API Key 입력..."}
                value={apiKey}
                disabled={apiKeySaved}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-zinc-200 dark:border-zinc-800 rounded-md bg-white dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 disabled:opacity-60 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
              />
              
              {apiKeySaved ? (
                <button
                  onClick={clearApiKey}
                  className="w-full py-1 text-center text-xs font-medium text-rose-600 bg-rose-50 dark:bg-rose-900/10 dark:text-rose-400 border border-rose-200 dark:border-rose-900/30 rounded-md hover:bg-rose-100 dark:hover:bg-rose-900/20 transition-all"
                >
                  API Key 변경
                </button>
              ) : (
                <button
                  onClick={saveApiKey}
                  disabled={!apiKey.trim()}
                  className="w-full py-1 text-center text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md shadow-sm transition-all"
                >
                  저장
                </button>
              )}
            </div>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">
              키를 저장하면 Gemini 모델을 통해 실제 대화 분석 및 심층 리포트를 받아볼 수 있습니다.
            </p>
          </div>

        </aside>

        {/* ========================================================
            2. CENTER PANEL: MAIN DASHBOARD PORTAL (55% -> lg:col-span-6 또는 col-span-7)
            ======================================================== */}
        <main className="lg:col-span-6 xl:col-span-7 p-6 space-y-6 overflow-y-auto h-full max-h-[calc(100vh-73px)] bg-zinc-50 dark:bg-[#09090b]">
          
          {loadingData ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] space-y-3">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">P&L 데이터 로드 중입니다...</p>
            </div>
          ) : errorData ? (
            <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/30 text-rose-800 dark:text-rose-400 rounded-xl p-6 text-center">
              <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
              <p className="text-xs text-rose-600 dark:text-rose-500 mt-1">{errorData}</p>
              <button 
                onClick={fetchData}
                className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-xs font-medium shadow-sm transition-all"
              >
                다시 시도
              </button>
            </div>
          ) : (
            <>
              {/* Section 1: Hero KPIs */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-extrabold uppercase tracking-wider text-zinc-400">전사 누적 요약 (Hero KPIs)</h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-500">
                      선택 기간: {selectedMonths.join(', ')} | 필터 데이터 {filteredData.length}건 집계
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => showCommentary('kpi')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors shadow-sm"
                    >
                      <MessageSquare size={13} />
                      코멘트
                    </button>
                    <button
                      onClick={() => generateAiAnalysis('kpi')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-all"
                    >
                      <Sparkles size={13} />
                      AI 분석
                    </button>
                  </div>
                </div>

                {/* KPI Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {[
                    {
                      id: "sales",
                      label: "총매출 (광고취급액)",
                      val: summaryMetrics.totalSales,
                      growth: momGrowth.totalSales,
                      desc: "총 대행 액수"
                    },
                    {
                      id: "revenue",
                      label: "영업수익 (실수익)",
                      val: summaryMetrics.operatingRevenue,
                      growth: momGrowth.operatingRevenue,
                      desc: "수수료 및 집행 수익"
                    },
                    {
                      id: "profit",
                      label: "영업실적 (수익-비용)",
                      val: summaryMetrics.operatingProfit,
                      growth: momGrowth.operatingProfit,
                      desc: "매출실적 - 운영경비"
                    },
                    {
                      id: "pl",
                      label: "관리손익 (실적-인건)",
                      val: summaryMetrics.managementPL,
                      growth: momGrowth.managementPL,
                      desc: "인건비 공제 후 최종이익"
                    }
                  ].map(card => {
                    const hasGrowth = card.growth !== null;
                    const isPositive = hasGrowth && card.growth >= 0;
                    
                    return (
                      <div
                        key={card.id}
                        className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700/80 transition-all flex flex-col justify-between"
                      >
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">{card.label}</p>
                          <h4 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50 font-mono">
                            {formatNum(card.val)} <span className="text-xs font-normal text-zinc-500">원</span>
                          </h4>
                        </div>
                        
                        <div className="mt-3.5 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-900 pt-2.5">
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{card.desc}</span>
                          
                          {hasGrowth ? (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-0.5 font-mono ${
                              isPositive
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950/30 dark:text-rose-400'
                            }`}>
                              {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                              {isPositive ? '+' : ''}{formatPercent(card.growth)}% (MoM)
                            </span>
                          ) : (
                            <span className="text-[10px] text-zinc-400 font-mono">- (MoM)</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Hero KPIs Dynamic Comment Panel */}
                {comments.kpi && (
                  <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30 rounded-xl p-4 relative transition-all duration-300">
                    <button onClick={() => closeComment('kpi')} className="absolute top-3 right-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                      <X size={15} />
                    </button>
                    <div className="flex gap-2">
                      <MessageSquare size={16} className="text-blue-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-blue-800 dark:text-blue-400 uppercase tracking-wider">Hero KPIs 정량 코멘트</p>
                        <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed font-sans">{comments.kpi}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Hero KPIs AI Analytics Panel */}
                {aiReports.kpi || loadingReports.kpi ? (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 relative transition-all duration-300 shadow-md">
                    <button onClick={() => closeAiReport('kpi')} className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300">
                      <X size={16} />
                    </button>
                    <div className="flex items-center gap-2 border-b border-zinc-800 pb-3 mb-3">
                      <Sparkles size={16} className="text-blue-400" />
                      <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">CFO 경영실적 AI 분석 레포트</h4>
                    </div>
                    {loadingReports.kpi ? (
                      <div className="flex items-center gap-2.5 text-xs text-zinc-400 py-3">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                        <span>Gemini AI 분석기 작동 중...</span>
                      </div>
                    ) : (
                      <div className="prose prose-invert max-w-none text-xs text-zinc-300 whitespace-pre-line leading-relaxed font-sans">
                        {aiReports.kpi}
                      </div>
                    )}
                  </div>
                ) : null}

              </section>

              {/* Section 2: Trend Chart */}
              <section className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 space-y-4 shadow-sm">
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-extrabold uppercase tracking-wider text-zinc-400">월별 손익 추이 (Trend Chart)</h3>
                    <p className="text-xs text-zinc-500">영업수익(바), 영업실적 & 관리손익(라인) 흐름도</p>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => showCommentary('trend')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors shadow-sm"
                    >
                      <MessageSquare size={13} />
                      코멘트
                    </button>
                    <button
                      onClick={() => generateAiAnalysis('trend')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-all"
                    >
                      <Sparkles size={13} />
                      AI 분석
                    </button>
                  </div>
                </div>

                {/* Composed Charts Row Stack */}
                <div className="space-y-6">
                  {/* Chart 1: Revenue, Profit, P&L */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-zinc-500 dark:text-zinc-400">1. 경영 손익 추이 (영업수익 / 영업실적 / 관리손익)</h4>
                    <div className="h-[240px] w-full font-mono">
                      {trendData.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                          데이터가 존재하지 않습니다. 필터 구성을 확인해 주세요.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={trendData}
                            margin={{ top: 10, right: -5, left: 10, bottom: 5 }}
                          >
                            <CartesianGrid stroke={darkMode ? "#1e1e24" : "#e4e4e7"} strokeDasharray="3 3" />
                            <XAxis 
                              dataKey="name" 
                              stroke={darkMode ? "#71717a" : "#71717a"} 
                              fontSize={11}
                              tickLine={false}
                            />
                            <YAxis 
                              stroke={darkMode ? "#71717a" : "#71717a"} 
                              fontSize={10} 
                              tickLine={false}
                              tickFormatter={(val) => `${(val / 1000000).toFixed(0)}M`}
                              width={40}
                            />
                            <Tooltip
                              formatter={(value) => [`${formatNum(value)}원`]}
                              contentStyle={{
                                backgroundColor: darkMode ? '#0c0c0f' : '#ffffff',
                                borderColor: darkMode ? '#1e1e24' : '#e4e4e7',
                                borderRadius: '8px',
                                color: darkMode ? '#fafafa' : '#09090b',
                                fontSize: '11px',
                                fontFamily: 'JetBrains Mono'
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                            
                            {/* Bar: Operating Revenue */}
                            <Bar 
                              name="영업수익" 
                              dataKey="영업수익" 
                              fill="#3b82f6" 
                              barSize={24} 
                              radius={[4, 4, 0, 0]} 
                              opacity={0.85}
                            />
                            
                            {/* Line: Operating Profit */}
                            <Line 
                              type="monotone" 
                              name="영업실적" 
                              dataKey="영업실적" 
                              stroke="#10b981" 
                              strokeWidth={2.5} 
                              dot={{ r: 3 }}
                            />
                            
                            {/* Line: Management P&L */}
                            <Line 
                              type="monotone" 
                              name="관리손익" 
                              dataKey="관리손익" 
                              stroke="#a78bfa" 
                              strokeWidth={2.5} 
                              dot={{ r: 3 }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  {/* Chart 2: Cash Inflow and Outflows (Total Sales, Operating Expense, Labor Cost) */}
                  <div className="space-y-2 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                    <h4 className="text-xs font-bold text-zinc-500 dark:text-zinc-400">2. 매출 및 비용 흐름 (총매출 / 영업비용 / 인건비)</h4>
                    <div className="h-[240px] w-full font-mono">
                      {trendData.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                          데이터가 존재하지 않습니다. 필터 구성을 확인해 주세요.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={trendData}
                            margin={{ top: 10, right: -5, left: 10, bottom: 5 }}
                          >
                            <CartesianGrid stroke={darkMode ? "#1e1e24" : "#e4e4e7"} strokeDasharray="3 3" />
                            <XAxis 
                              dataKey="name" 
                              stroke={darkMode ? "#71717a" : "#71717a"} 
                              fontSize={11}
                              tickLine={false}
                            />
                            <YAxis 
                              stroke={darkMode ? "#71717a" : "#71717a"} 
                              fontSize={10} 
                              tickLine={false}
                              tickFormatter={(val) => `${(val / 1000000).toFixed(0)}M`}
                              width={40}
                            />
                            <Tooltip
                              formatter={(value) => [`${formatNum(value)}원`]}
                              contentStyle={{
                                backgroundColor: darkMode ? '#0c0c0f' : '#ffffff',
                                borderColor: darkMode ? '#1e1e24' : '#e4e4e7',
                                borderRadius: '8px',
                                color: darkMode ? '#fafafa' : '#09090b',
                                fontSize: '11px',
                                fontFamily: 'JetBrains Mono'
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                            
                            {/* Bar: Total Sales */}
                            <Bar 
                              name="총매출 (광고취급액)" 
                              dataKey="총매출" 
                              fill="#60a5fa" 
                              barSize={24} 
                              radius={[4, 4, 0, 0]} 
                              opacity={0.85}
                            />
                            
                            {/* Line: Operating Expense */}
                            <Line 
                              type="monotone" 
                              name="영업비용" 
                              dataKey="영업비용" 
                              stroke="#f43f5e" 
                              strokeWidth={2.5} 
                              dot={{ r: 3 }}
                            />
                            
                            {/* Line: Labor Cost */}
                            <Line 
                              type="monotone" 
                              name="인건비" 
                              dataKey="인건비" 
                              stroke="#fbbf24" 
                              strokeWidth={2.5} 
                              dot={{ r: 3 }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>

                {/* Trend Comment Panel */}
                {comments.trend && (
                  <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30 rounded-xl p-4 relative transition-all duration-300">
                    <button onClick={() => closeComment('trend')} className="absolute top-3 right-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                      <X size={15} />
                    </button>
                    <div className="flex gap-2">
                      <MessageSquare size={16} className="text-blue-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-blue-800 dark:text-blue-400 uppercase tracking-wider">Trend Chart 정량 코멘트</p>
                        <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed font-sans">{comments.trend}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Trend AI Analysis Panel */}
                {aiReports.trend || loadingReports.trend ? (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 relative transition-all duration-300 shadow-md">
                    <button onClick={() => closeAiReport('trend')} className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300">
                      <X size={16} />
                    </button>
                    <div className="flex items-center gap-2 border-b border-zinc-800 pb-3 mb-3">
                      <Sparkles size={16} className="text-blue-400" />
                      <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">시계열 추이 AI 컨설팅 보고서</h4>
                    </div>
                    {loadingReports.trend ? (
                      <div className="flex items-center gap-2.5 text-xs text-zinc-400 py-3">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                        <span>Gemini AI 데이터 모델 분석 중...</span>
                      </div>
                    ) : (
                      <div className="prose prose-invert max-w-none text-xs text-zinc-300 whitespace-pre-line leading-relaxed font-sans">
                        {aiReports.trend}
                      </div>
                    )}
                  </div>
                ) : null}

              </section>

              {/* Section 3: Performance Tower */}
              <section className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800/80 rounded-xl p-5 space-y-4 shadow-sm">
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-extrabold uppercase tracking-wider text-zinc-400">실적 타워 (Top & Bottom 테이블)</h3>
                    <p className="text-xs text-zinc-500">부서 및 주요 광고주 관리손익 랭킹</p>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => showCommentary('tower')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors shadow-sm"
                    >
                      <MessageSquare size={13} />
                      코멘트
                    </button>
                    <button
                      onClick={() => generateAiAnalysis('tower')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-all"
                    >
                      <Sparkles size={13} />
                      AI 분석
                    </button>
                  </div>
                </div>

                {/* Tab Controls */}
                <div className="border-b border-zinc-200 dark:border-zinc-850 flex gap-4 text-xs font-medium">
                  {[
                    { id: "dept", label: "부서별 실적 Top 10" },
                    { id: "clientSurplus", label: "광고주 흑자 Top 10" },
                    { id: "clientDeficit", label: "광고주 적자 Top 10" }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`pb-2 border-b-2 transition-all ${
                        activeTab === tab.id
                          ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-bold'
                          : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Table Render */}
                <div className="overflow-x-auto min-h-[300px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 uppercase tracking-wider font-semibold">
                        <th className="py-2.5 px-3">순위</th>
                        <th className="py-2.5 px-3">{activeTab === 'dept' ? '담당부서명' : '광고주명(코드)'}</th>
                        <th className="py-2.5 px-3 text-right">총매출</th>
                        <th className="py-2.5 px-3 text-right">영업수익</th>
                        <th className="py-2.5 px-3 text-right">인건비</th>
                        <th className="py-2.5 px-3 text-right">관리손익</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900/60 text-zinc-800 dark:text-zinc-200">
                      {paginatedList.length === 0 ? (
                        <tr><td colSpan="6" className="py-6 text-center text-zinc-500">해당하는 데이터가 없습니다.</td></tr>
                      ) : (
                        paginatedList.map((item, index) => {
                          const globalIdx = (currentPage - 1) * ITEMS_PER_PAGE + index + 1;
                          return (
                            <tr key={item.name} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
                              <td className="py-3 px-3 font-mono font-bold text-zinc-400">{globalIdx}</td>
                              <td className="py-3 px-3 font-medium truncate max-w-[220px]" title={item.name}>{item.name}</td>
                              <td className="py-3 px-3 text-right font-mono">{formatNum(item.sales)}</td>
                              <td className="py-3 px-3 text-right font-mono">{formatNum(item.revenue)}</td>
                              <td className="py-3 px-3 text-right font-mono">{formatNum(item.labor)}</td>
                              <td className={`py-3 px-3 text-right font-mono font-semibold ${
                                activeTab === 'clientSurplus' ? 'text-emerald-500' :
                                activeTab === 'clientDeficit' ? 'text-rose-500' :
                                (item.managementPL >= 0 ? 'text-emerald-500' : 'text-rose-500')
                              }`}>
                                {formatNum(item.managementPL)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls Row */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800 text-xs">
                  <span className="text-zinc-500">
                    총 {activeList.length}개 중 {activeList.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}-{Math.min(activeList.length, currentPage * ITEMS_PER_PAGE)}개 표시
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="py-1 px-2.5 rounded-md border border-zinc-200 dark:border-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors bg-white dark:bg-zinc-900 shadow-sm"
                    >
                      이전
                    </button>
                    <span className="text-zinc-500 font-mono">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="py-1 px-2.5 rounded-md border border-zinc-200 dark:border-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors bg-white dark:bg-zinc-900 shadow-sm"
                    >
                      다음
                    </button>
                  </div>
                </div>

                {/* Performance Tower Comment Panel */}
                {comments.tower && (
                  <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30 rounded-xl p-4 relative transition-all duration-300">
                    <button onClick={() => closeComment('tower')} className="absolute top-3 right-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                      <X size={15} />
                    </button>
                    <div className="flex gap-2">
                      <MessageSquare size={16} className="text-blue-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-blue-800 dark:text-blue-400 uppercase tracking-wider">Performance Tower 정량 코멘트</p>
                        <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed font-sans">{comments.tower}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Performance Tower AI Analysis Panel */}
                {aiReports.tower || loadingReports.tower ? (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 relative transition-all duration-300 shadow-md">
                    <button onClick={() => closeAiReport('tower')} className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300">
                      <X size={16} />
                    </button>
                    <div className="flex items-center gap-2 border-b border-zinc-800 pb-3 mb-3">
                      <Sparkles size={16} className="text-blue-400" />
                      <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">성과 기획 포트폴리오 AI 개선 진단서</h4>
                    </div>
                    {loadingReports.tower ? (
                      <div className="flex items-center gap-2.5 text-xs text-zinc-400 py-3">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                        <span>Gemini AI 대조 진단 중...</span>
                      </div>
                    ) : (
                      <div className="prose prose-invert max-w-none text-xs text-zinc-300 whitespace-pre-line leading-relaxed font-sans">
                        {aiReports.tower}
                      </div>
                    )}
                  </div>
                ) : null}

              </section>
            </>
          )}

        </main>

        {/* ========================================================
            3. RIGHT PANEL: AI CHATBOT SIDEBAR (25% -> lg:col-span-3 또는 col-span-3)
            ======================================================== */}
        <aside className="lg:col-span-3 xl:col-span-3 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] flex flex-col h-full overflow-hidden min-h-[calc(100vh-73px)] justify-between">
          
          {/* Chat Header */}
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/10">
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-blue-500" />
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
                P&L 의사결정 AI 챗봇
              </h2>
            </div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 flex flex-col items-end font-mono leading-tight">
              <span>{apiKeySaved ? detectedModel.modelName : 'Mock 모드'}</span>
              {apiKeySaved && <span className="text-[8px] opacity-70">API: {detectedModel.apiVersion}</span>}
            </div>
          </div>

          {/* Quick preset questions chips */}
          <div className="px-4 py-2 bg-zinc-50/30 dark:bg-zinc-900/10 border-b border-zinc-100 dark:border-zinc-900">
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mb-1.5 font-bold">임원진 추천 질문 리스트:</p>
            <div className="flex flex-col gap-1.5">
              {[
                "이번 달 가장 영업비용이 많이 발생한 부서는 어디야?",
                "관리손익 적자가 가장 심한 광고주는 누구야?",
                "신규 영업 광고주의 수익 전환율은 어때?"
              ].map(qText => (
                <button
                  key={qText}
                  onClick={() => {
                    setChatInput(qText);
                  }}
                  className="text-left text-[11px] p-1.5 rounded bg-zinc-100 dark:bg-zinc-800/80 hover:bg-blue-500/10 hover:text-blue-600 dark:hover:bg-blue-500/20 dark:hover:text-blue-400 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700/60 truncate transition-all font-sans"
                  title={qText}
                >
                  {qText}
                </button>
              ))}
            </div>
          </div>

          {/* Chat message history list */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-zinc-50/20 dark:bg-zinc-950/20">
            {chatMessages.map(msg => (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[85%] ${msg.sender === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
              >
                <div className={`text-[10px] text-zinc-400 dark:text-zinc-500 mb-1 font-semibold ${msg.sender === 'user' ? 'mr-1' : 'ml-1'}`}>
                  {msg.sender === 'user' ? '임원 (나)' : 'Gemini AI CFO'}
                </div>
                <div
                  className={`p-3 rounded-xl text-xs leading-relaxed whitespace-pre-line shadow-sm border font-sans ${
                    msg.sender === 'user'
                      ? 'bg-blue-600 border-blue-700 text-white rounded-tr-none'
                      : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-tl-none'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {/* Chatbot loading state */}
            {chatLoading && (
              <div className="flex flex-col max-w-[80%] mr-auto items-start">
                <div className="text-[10px] text-zinc-400 mb-1 ml-1 font-semibold">Gemini AI CFO</div>
                <div className="p-3 rounded-xl text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-400 rounded-tl-none flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3 w-3 border border-zinc-400 border-t-transparent"></div>
                  <span>답변을 작성하고 있습니다...</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Chat Form Input */}
          <form onSubmit={handleChatSubmit} className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0c0c0f] flex gap-2">
            <input
              type="text"
              placeholder="데이터 분석 질문 입력..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="flex-1 px-3 py-2 text-xs border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all font-sans"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || chatLoading}
              className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all"
            >
              <Send size={14} />
            </button>
          </form>

        </aside>

      </div>
      
    </div>
  );
}
