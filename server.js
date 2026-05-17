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

const COMMENTS_KEY = "__comments";
const MAX_COMMENTS = 80;
const DEFAULT_COMMENTS = [
  {
    id: "virtual-1",
    name: "茶水间观察员",
    text: "测出来是工位影帝，感觉这不是测试，是监控录像。",
    typeCn: "工位影帝",
    typeEn: "ACTR",
    createdAt: "2026-05-17T01:00:00.000Z",
    virtual: true
  },
  {
    id: "virtual-2",
    name: "周一受害者",
    text: "灵魂离职人报道。我的工牌还在，我本人已经在精神世界请假。",
    typeCn: "灵魂离职人",
    typeEn: "BYEE",
    createdAt: "2026-05-17T01:01:00.000Z",
    virtual: true
  },
  {
    id: "virtual-3",
    name: "键盘演奏家",
    text: "已读乱回者很准，我每天都在收到、好的、辛苦了之间随机播放。",
    typeCn: "已读乱回者",
    typeEn: "RAND",
    createdAt: "2026-05-17T01:02:00.000Z",
    virtual: true
  },
  {
    id: "virtual-4",
    name: "龟背竹邻居",
    text: "最角落工位真的有安全感，至少植物不会临时加需求。",
    typeCn: "长睡眠者",
    typeEn: "SLPY",
    createdAt: "2026-05-17T01:03:00.000Z",
    virtual: true
  }
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
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
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

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
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

function getStoredComments(db) {
  return Array.isArray(db[COMMENTS_KEY]) ? db[COMMENTS_KEY] : [];
}

function sanitizeComment(comment) {
  return {
    id: comment.id,
    name: comment.name,
    text: comment.text,
    shareCode: comment.shareCode,
    mytiCode: comment.mytiCode,
    typeCn: comment.typeCn,
    typeEn: comment.typeEn,
    replyTo: comment.replyTo,
    createdAt: comment.createdAt,
    virtual: Boolean(comment.virtual)
  };
}

function publicComments(db) {
  return getStoredComments(db).concat(DEFAULT_COMMENTS).slice(0, 40).map(sanitizeComment);
}

function getComments(req, res) {
  const db = readDb();
  sendJson(res, 200, { comments: publicComments(db) });
}

function saveComment(req, res) {
  readBody(req)
    .then(body => {
      const text = cleanText(body.text, 120);
      if (!text) {
        sendJson(res, 400, { error: "评论内容不能为空" });
        return;
      }

      const db = readDb();
      const mytiCode = /^[HL]{4}$/.test(body.mytiCode) ? body.mytiCode : "";
      const fallbackType = mytiCode && TYPE_DATA[mytiCode] ? TYPE_DATA[mytiCode] : {};
      const comments = getStoredComments(db);
      const replyId = cleanText(body.replyTo, 80);
      const target = replyId
        ? comments.concat(DEFAULT_COMMENTS).find(item => item.id === replyId)
        : null;
      const comment = {
        id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name: cleanText(body.name, 16) || "匿名工位人",
        text,
        ownerKey: cleanText(body.ownerKey, 120),
        shareCode: cleanCode(body.shareCode).slice(0, 8),
        mytiCode,
        typeCn: cleanText(body.typeCn || fallbackType.cn, 18),
        typeEn: cleanText(body.typeEn || fallbackType.en, 8),
        replyTo: target ? { id: target.id, name: target.name || "匿名工位人" } : null,
        createdAt: new Date().toISOString()
      };

      db[COMMENTS_KEY] = [comment].concat(comments).slice(0, MAX_COMMENTS);
      writeDb(db);
      sendJson(res, 200, { comment: sanitizeComment(comment), comments: publicComments(db) });
    })
    .catch(error => sendJson(res, 400, { error: error.message || "评论发布失败" }));
}

function deleteComment(req, res, id) {
  readBody(req)
    .then(body => {
      const db = readDb();
      const ownerKey = cleanText(body.ownerKey, 120);
      const comments = getStoredComments(db);
      const target = comments.find(comment => comment.id === id);
      if (!target) {
        sendJson(res, 404, { error: "没有找到这条留言" });
        return;
      }
      if (!ownerKey || ownerKey !== target.ownerKey) {
        sendJson(res, 403, { error: "只能删除自己发布的留言" });
        return;
      }

      db[COMMENTS_KEY] = comments.filter(comment => comment.id !== id);
      writeDb(db);
      sendJson(res, 200, { ok: true, comments: publicComments(db) });
    })
    .catch(error => sendJson(res, 400, { error: error.message || "删除失败" }));
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
  if (req.method === "GET" && url.pathname === "/api/comments") {
    getComments(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/comments") {
    saveComment(req, res);
    return;
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/api/comments/")) {
    deleteComment(req, res, decodeURIComponent(url.pathname.split("/").pop()));
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
