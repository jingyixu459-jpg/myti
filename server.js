const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DB_FILE = process.env.MYTI_DB_FILE
  ? path.resolve(process.env.MYTI_DB_FILE)
  : path.join(ROOT, "data", "results.json");
const DATA_DIR = path.dirname(DB_FILE);

const TYPE_DATA = {
  HHHH: { cn: "终极BOSS", en: "BOSS" },
  HHHL: { cn: "电子魅魔", en: "WIFI" },
  HHLH: { cn: "工位影帝", en: "ACTR" },
  HHLL: { cn: "赛博忍者", en: "NINJ" },
  HLHH: { cn: "微型崩溃体", en: "MINC" },
  HLHL: { cn: "周一焦虑者", en: "MOND" },
  HLLH: { cn: "自动回复体", en: "AUTO" },
  HLLL: { cn: "长睡眠者", en: "SLPY" },
  LHHH: { cn: "工位祭司", en: "DESK" },
  LHHL: { cn: "发疯文学家", en: "CRAZ" },
  LHLH: { cn: "带薪修仙者", en: "ZENX" },
  LHLL: { cn: "灵魂离职人", en: "BYEE" },
  LLHH: { cn: "职场小强", en: "ROCH" },
  LLHL: { cn: "已读乱回者", en: "RAND" },
  LLLH: { cn: "工位变色龙", en: "CAMO" },
  LLLL: { cn: "人间蒸发者", en: "LOST" }
};

const DIMENSIONS = [
  { key: "perform", cn: "演技" },
  { key: "escape", cn: "摸鱼" },
  { key: "chaos", cn: "发疯" },
  { key: "survive", cn: "生存" }
];

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "{}", "utf8");
}

function readDb() {
  ensureDb();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8") || "{}");
  } catch (error) {
    return {};
  }
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("请求太大了"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("JSON 格式不正确"));
      }
    });
    req.on("error", reject);
  });
}

function makeCode(db) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let tries = 0; tries < 200; tries++) {
    let code = "";
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!db[code]) return code;
  }
  return String(Date.now()).slice(-6);
}

function cleanCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function saveResult(req, res) {
  readBody(req)
    .then(body => {
      const mytiCode = /^[HL]{4}$/.test(body.mytiCode) ? body.mytiCode : null;
      if (!mytiCode || !TYPE_DATA[mytiCode]) {
        sendJson(res, 400, { error: "MYTI 结果不正确" });
        return;
      }

      const db = readDb();
      const shareCode = makeCode(db);
      const type = TYPE_DATA[mytiCode];
      db[shareCode] = {
        shareCode,
        mytiCode,
        typeCn: body.typeCn || type.cn,
        typeEn: body.typeEn || type.en,
        scores: normalizeScores(body.scores),
        answers: Array.isArray(body.answers) ? body.answers.slice(0, 12) : [],
        createdAt: body.createdAt || new Date().toISOString(),
        userAgent: req.headers["user-agent"] || ""
      };
      writeDb(db);
      sendJson(res, 200, { shareCode, result: db[shareCode] });
    })
    .catch(error => sendJson(res, 400, { error: error.message || "保存失败" }));
}

function normalizeScores(scores) {
  const out = {};
  DIMENSIONS.forEach(dim => {
    const value = Number(scores && scores[dim.key]);
    out[dim.key] = Number.isFinite(value) ? value : 0;
  });
  return out;
}

function getResult(req, res, code) {
  const db = readDb();
  const item = db[cleanCode(code)];
  if (!item) {
    sendJson(res, 404, { error: "没有找到这个匹配代码" });
    return;
  }
  sendJson(res, 200, item);
}

function getMatch(req, res, url) {
  const codeA = cleanCode(url.searchParams.get("codeA"));
  const codeB = cleanCode(url.searchParams.get("codeB"));
  const db = readDb();
  const a = db[codeA];
  const b = db[codeB];
  if (!a || !b) {
    sendJson(res, 404, { error: "没有查到其中一个代码，请确认两个人都已完成测试。" });
    return;
  }
  sendJson(res, 200, buildMatch(a, b));
}

function buildMatch(a, b) {
  const ac = a.mytiCode;
  const bc = b.mytiCode;
  const comments = [];
  let score = 0;

  const rules = [
    {
      key: "perform",
      cn: "演技",
      points: { HH: 22, LL: 15, diff: 12 },
      hh: "你们都很会演，老板路过时能自动组成双人职场舞台剧。",
      ll: "你们都偏真诚，适合做彼此的低伪装安全区。",
      diff: "一个负责体面表演，一个负责露出破绽，组合效果有点危险也有点真实。"
    },
    {
      key: "escape",
      cn: "摸鱼",
      points: { HH: 22, LL: 15, diff: 12 },
      hh: "你们摸鱼频率高度一致，很适合共享茶水间情报和下班倒计时。",
      ll: "你们都比较坐得住，合作时不太容易一起消失。",
      diff: "一个想逃，一个还能坐住，容易形成拉扯型工位关系。"
    },
    {
      key: "chaos",
      cn: "发疯",
      points: { HH: 14, LL: 22, diff: 17 },
      hh: "你们都自带高压锅属性，快乐是真的，爆炸也是真的。",
      ll: "你们精神波动都比较低，适合一起稳定交付。",
      diff: "一个点火，一个灭火，反而能形成奇妙的办公室生态平衡。"
    },
    {
      key: "survive",
      cn: "生存",
      points: { HH: 24, LL: 9, diff: 17 },
      hh: "你们都很能扛，属于项目废墟里还能互相递咖啡的类型。",
      ll: "你们生存电量都偏低，建议不要同时接急活。",
      diff: "一个负责续命，一个负责瘫倒，互补但需要明确谁先去接水。"
    }
  ];

  rules.forEach((rule, index) => {
    const pair = ac[index] + bc[index];
    if (pair === "HH") {
      score += rule.points.HH;
      comments.push(`${rule.cn}：${rule.hh}`);
    } else if (pair === "LL") {
      score += rule.points.LL;
      comments.push(`${rule.cn}：${rule.ll}`);
    } else {
      score += rule.points.diff;
      comments.push(`${rule.cn}：${rule.diff}`);
    }
  });

  if (ac === bc) score += 8;
  if (ac[1] === "H" && bc[1] === "H") score += 4;
  if ((ac[2] === "H" && bc[3] === "H") || (bc[2] === "H" && ac[3] === "H")) score += 3;
  score = Math.max(1, Math.min(99, score));

  const level = matchLevel(score);
  const aName = `${a.typeCn} ${a.typeEn}`;
  const bName = `${b.typeCn} ${b.typeEn}`;
  return {
    score,
    level,
    pairTitle: `${a.typeCn} × ${b.typeCn}`,
    summary: `${aName} 和 ${bName} 的关系是「${level}」。`,
    analysis: comments.slice(0, 4).join(" "),
    a: publicResult(a),
    b: publicResult(b),
    dimensions: rules.map((rule, index) => ({
      name: rule.cn,
      a: ac[index],
      b: bc[index]
    }))
  };
}

function matchLevel(score) {
  if (score >= 90) return "天选摸鱼搭子";
  if (score >= 78) return "高浓度办公室搭子";
  if (score >= 65) return "稳定互补型";
  if (score >= 52) return "需要磨合但能一起活";
  return "建议错峰摸鱼";
}

function publicResult(item) {
  return {
    shareCode: item.shareCode,
    mytiCode: item.mytiCode,
    typeCn: item.typeCn,
    typeEn: item.typeEn,
    scores: item.scores
  };
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const target = path.normalize(path.join(ROOT, pathname));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const type = ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".js" ? "application/javascript; charset=utf-8"
      : ext === ".css" ? "text/css; charset=utf-8"
      : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/results") {
    saveResult(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/results/")) {
    getResult(req, res, url.pathname.split("/").pop());
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/match") {
    getMatch(req, res, url);
    return;
  }
  if (req.method === "GET") {
    serveStatic(req, res, url);
    return;
  }
  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, () => {
  ensureDb();
  console.log(`MYTI server running: http://localhost:${PORT}`);
  console.log(`Results database: ${DB_FILE}`);
});
