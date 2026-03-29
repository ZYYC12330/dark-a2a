# dark-a2a

暗林单服沙盘 Demo（A2A x pi-mono）快速落地仓库。

## 目标（Demo First）

本仓库以**快速产出可观战演示**为第一优先级，强调：

- 玩家只在开局配置参数，之后旁观。
- 单服权威模拟，客户端只做展示。
- 黑暗森林核心体验聚焦在：
  - 信息延迟（光速窗口）
  - 通信可疑（截获/伪造/重放）
  - 因果可解释（为什么开火）
  - 可回放（关键时刻复盘）

> 非目标（当前阶段）：完整A2A绑定矩阵、真实密码学、复杂3D物理、完整科技/经济系统、外接AI。


## 快速运行

```bash
npm start
# 打开 http://localhost:3000

# 运行基础烟雾测试
npm test
```

- 服务会自动启动脚本化模拟并通过 SSE 推送事件。
- 可点击页面中的 `Start` 按钮继续模拟，或使用 `Reset` 一键重置脚本。

---

## Demo 范围冻结（MVP）

### 1) 协议层（最小实现）

只保留：

- `POST /message:send`
- `GET /stream/events`（SSE）

统一消息结构（示意）：

```json
{
  "messageId": "uuid",
  "contextId": "session-1",
  "from": "CivC.Comms",
  "to": "CivD.Comms",
  "type": "diplomacy|scan|strike|intel",
  "payload": {},
  "meta": {
    "sigValid": false,
    "isReplay": false,
    "isSpoofed": true,
    "sourceTrust": 0.32
  },
  "tickCreated": 3,
  "tickArrive": 5
}
```

### 2) 模拟层（可讲故事）

保留：

- 4个文明
- 12~20 tick
- 2D星图坐标
- 距离产生消息到达延迟
- 截获概率判定
- 伪造/重放标签
- 基于阈值的开火决策

砍掉：

- 相对论时间膨胀
- 3D机动
- 复杂战斗细节
- 深科技树与生产链

### 3) 资源和判定（极简）

资源只保留三条：

- `Energy`
- `Intel`
- `Exposure`

胜利条件只保留：

- 到达终局时存活，或成为最后幸存文明。

### 4) 策略驱动（全脚本）

统一接口：

```ts
interface PolicyProvider {
  getAction(observation: Observation, tick: number): PlannedAction[];
}
```

首版仅实现 `ScriptedPolicyProvider`（YAML/JSON 读剧本）。

---

## UI/UX（优先级最高）

单页三栏：

1. 左：告警与日志流（按严重级别着色）
2. 中：2D星图（神视/文明视角切换）
3. 右：因果链（谁基于何证据做了什么）

必须可见的演示点：

- 消息在途倒计时
- 截获事件
- 伪造或重放告警
- 开火触发依据（threat/confidence/exposure）
- 时间轴跳转关键tick（T3/T8/T12）

---

## 脚本剧情模板（建议默认）

剧情弧线：

`诱饵停火 -> 误信 -> 先发 -> 报复`

基础脚本字段（示意）：

```yaml
seed: 20260328
ticks: 12
civs:
  - id: CivA
    doctrine: { roe: 0.75, commBudget: 0.2 }
  - id: CivB
    doctrine: { roe: 0.55, commBudget: 0.4 }
  - id: CivC
    doctrine: { roe: 0.35, commBudget: 0.6 }
  - id: CivD
    doctrine: { roe: 0.65, commBudget: 0.3 }
events:
  - tick: 1
    type: spoof_message
    from: CivC.Comms
    to: CivD.Comms
    payload: { template: ceasefire_bait_v1, sigValid: false }
  - tick: 3
    type: intercept
    watcher: CivA
    targetMessageId: msg-001
  - tick: 8
    type: strike
    from: CivD
    to: CivC
```

---

## 开发节奏（建议）

### Day 1-2
- 定义数据结构（Message/Event/Observation/Action）
- 跑通脚本读取与tick循环

### Day 3-4
- 做消息延迟、截获、伪造/重放标记
- 打通SSE事件推送

### Day 5-6
- 完成单页UI三栏
- 接时间轴与关键事件书签

### Day 7
- 打磨演示叙事
- 录制观战视频

---

## 里程碑后的升级方向（v2+）

- 接入 pi-agent-core / pi-ai 的真实 Agent loop
- 扩展 A2A Task 生命周期
- 接入真实签名验签与密钥轮换
- 引入 gRPC / JSON-RPC 绑定
- 加入更完整的经济和科技系统
