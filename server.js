const express = require('express');
const AbortController = global.AbortController || require('abort-controller');
const fetch = global.fetch || require('node-fetch');

const app = express();

const PORT = Number(process.env.PORT || 80);
const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
const DEEPSEEK_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS || 12000);

const COACH_MESSAGES = [
  '先别求全，先动第一步。',
  '把门槛降下来，开始就赢了。',
  '先做最小动作，节奏会起来。',
  '现在只管开头，不用想太远。'
];

const QUICK_TIPS = [
  '先做 3 分钟，不求做完。',
  '把手机放远一点再开始。',
  '先完成最容易的一步。',
  '卡住时，把动作继续拆小。'
];

app.use(express.json({ limit: '1mb' }));

function safeJsonParse(rawText) {
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch (error) {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (nestedError) {
      return null;
    }
  }
}

function pickCoachMessage(task) {
  const text = String(task || '');
  const index = text.length % COACH_MESSAGES.length;
  return COACH_MESSAGES[index];
}

function pickTips(task) {
  const text = String(task || '');
  const start = text.length % QUICK_TIPS.length;
  return [
    QUICK_TIPS[start],
    QUICK_TIPS[(start + 1) % QUICK_TIPS.length]
  ];
}

function normalizePlan(task, data) {
  const steps = Array.isArray(data.steps) ? data.steps : [];

  return {
    coachMsg: pickCoachMessage(task),
    steps: steps
      .filter((item) => item && item.action)
      .slice(0, 4)
      .map((item, index) => ({
        emoji: item.emoji || `${index + 1}.`,
        action: String(item.action).trim(),
        reason: item.reason ? String(item.reason).trim() : '先把开始变简单一点',
        isDone: false,
        doneAt: ''
      })),
    tips: pickTips(task)
  };
}

function buildRequestBody(task) {
  return {
    model: 'deepseek-chat',
    temperature: 0.2,
    max_tokens: 220,
    messages: [
      {
        role: 'system',
        content: [
          '你是任务拆解助手。',
          '用简体中文。',
          '只返回 JSON。',
          '格式：{"steps":[{"emoji":"1.","action":"...","reason":"..."}]}',
          '固定输出 4 个极小步骤。',
          '每步 8 到 18 个字。'
        ].join(' ')
      },
      {
        role: 'user',
        content: `任务：${task}`
      }
    ]
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`DeepSeek 请求超时（>${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createPlan(task) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('服务端未配置 DEEPSEEK_API_KEY');
  }

  const response = await fetchWithTimeout(
    'https://api.deepseek.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify(buildRequestBody(task))
    },
    DEEPSEEK_TIMEOUT_MS
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek 请求失败：${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';

  const parsed = safeJsonParse(content);
  if (!parsed) {
    throw new Error('DeepSeek 返回内容不是合法 JSON');
  }

  const plan = normalizePlan(task, parsed);
  if (!plan.steps.length) {
    throw new Error('DeepSeek 未返回有效步骤');
  }

  return plan;
}

app.get('/healthz', (req, res) => {
  res.json({
    success: true,
    service: 'deepseek-plan-service'
  });
});

app.post('/plan', async (req, res) => {
  const task = typeof req.body.task === 'string' ? req.body.task.trim() : '';
  if (!task) {
    return res.status(400).json({
      success: false,
      message: 'task is required'
    });
  }

  try {
    const plan = await createPlan(task);
    return res.json({
      success: true,
      plan
    });
  } catch (error) {
    console.error('createPlan failed:', error);
    return res.status(500).json({
      success: false,
      message: error && error.message ? error.message : 'DeepSeek 生成失败'
    });
  }
});

app.listen(PORT, () => {
  console.log(`deepseek-plan-service listening on ${PORT}`);
});
