# CloudRun Service

服务名称建议：`deepseek-plan-service`

## 环境变量

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_TIMEOUT_MS` 可选，默认 `12000`

## 接口

- `GET /healthz`
- `POST /plan`

请求体：

```json
{
  "task": "我要开始写小程序"
}
```

返回：

```json
{
  "success": true,
  "plan": {
    "coachMsg": "先别求全，先动第一步。",
    "steps": [
      {
        "emoji": "1.",
        "action": "打开项目目录",
        "reason": "先进入工作状态",
        "isDone": false,
        "doneAt": ""
      }
    ],
    "tips": ["先做 3 分钟，不求做完。", "把手机放远一点再开始。"]
  }
}
```
