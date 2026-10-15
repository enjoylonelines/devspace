<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/Waishnav/devspace/main/docs/assets/devspace-logo-light.png" alt="DevSpace logo" width="140">
  </picture>
</p>

<h1 align="center">DevSpace</h1>

<p align="center">Bring a Codex-style coding workflow to ChatGPT.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@waishnav/devspace"><img alt="npm" src="https://img.shields.io/npm/v/%40waishnav%2Fdevspace?style=flat-square" /></a>
  <a href="https://github.com/Waishnav/devspace/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Waishnav/devspace/ci.yml?style=flat-square&branch=main" /></a>
  <a href="https://github.com/Waishnav/devspace/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/npm/l/%40waishnav%2Fdevspace?style=flat-square" /></a>
</p>

[![DevSpace connected to ChatGPT](https://raw.githubusercontent.com/Waishnav/devspace/main/docs/assets/devspace-screenshot.png)](https://raw.githubusercontent.com/Waishnav/devspace/main/docs/assets/devspace-screenshot.png)

**Give ChatGPT a secure connection to your own machine and Turn ChatGPT into Codex**

DevSpace is a self-hosted MCP server that lets ChatGPT read, edit, search, and run code in your real local projects — your files, your tools, your terminal — without uploading anything to a third party. You run it on your machine, expose it through a tunnel you control, and approve the connection with a password only you have.

The same `/mcp` endpoint serves the 2026-07-28 per-request protocol and automatically supports older 2025-era clients through stateless compatibility handling. There is no protocol mode to configure.

## 멀티워커 MCP 실행 안정성 보강

> 구현 브랜치: [`fix/mcp-resilience`](https://github.com/enjoylonelines/devspace/tree/fix/mcp-resilience)<br />
> DevSpace 오픈소스를 기반으로, ChatGPT가 로컬 작업을 계속 이어갈 수 있도록 MCP 워커의 준비 상태·세션 복구·호환성 경로를 보강했습니다.

### 프로젝트 요약

| 항목 | 내용 |
| --- | --- |
| 배경 | 장시간 작업 중 특정 MCP 워커가 중단되면, 같은 세션이 기본 워커로 이동해 로컬 프로세스 세션을 다시 열어야 하는 문제가 있었습니다. |
| 서버 문제 | 단순 HTTP 응답 확인만으로는 실제 MCP 도구 호출이 가능한지 알 수 없고, 워커별 실행 포트와 요청 종료 원인을 추적하기 어려웠습니다. |
| 설계 | 각 워커는 독립 포트에서 실행하고, 라우터는 세션을 워커에 고정합니다. 워커가 중단되면 준비 상태를 확인한 뒤 정상 워커로 세션을 넘기고 프로세스 세션 재연결 신호를 전달합니다. |
| 구현 | `DEVSPACE_PORT` 포트 오버라이드, `/readyz` MCP 준비 상태 확인, MCP 요청 시작·완료·중단 로그, 기존 도구 입력 호환을 구현했습니다. |
| 검증 | 워커 소유 세션을 강제로 중단하는 30회 로컬 라우터 통합 실험으로 세션 연속성과 복구 경로를 비교했습니다. |

### 멀티워커 실행 구조

```mermaid
flowchart LR
    H[MCP Host<br/>ChatGPT / Claude] --> R[고정 진입점 라우터]
    R -->|mcp-session-id| A[DevSpace Worker A]
    R -->|mcp-session-id| B[DevSpace Worker B]

    R -. 준비 상태 확인 .-> A
    R -. 준비 상태 확인 .-> B
    A --> M[/mcp 도구 호출]
    B --> M

    A -. 워커 중단 .-> R
    R -->|정상 워커로 복구| B
    R -->|process-sessions 재연결 신호| H
```

### 구현한 서버 책임

| 변경 | 처리 내용 |
| --- | --- |
| 워커별 포트 | `DEVSPACE_PORT` 환경 변수로 워커마다 다른 포트에서 DevSpace 서버를 실행 |
| 실제 MCP 준비 상태 | `/readyz`에서 MCP `tools/list` 요청을 실행해 도구 호출 경로가 준비됐을 때만 성공 응답 |
| 요청 추적 | `/mcp` 요청의 시작·완료·오류·클라이언트 중단을 요청 식별자와 처리 시간으로 기록 |
| 세션 복구 | 라우터가 중단된 세션 소유 워커를 감지하면 정상 커스텀 워커로 넘기고 `process-sessions` 재연결 신호 전달 |
| 기존 클라이언트 호환 | `workspaceId`/`workspace_id`, `oldText`/`old_text` 등 기존·현재 입력 형식을 함께 수용 |
| 프록시 신뢰 범위 | 전달 IP 헤더는 역방향 프록시 한 홉만 신뢰하도록 제한 |

### 검증 결과

동일 세션을 특정 워커에 고정한 뒤, 그 워커를 중단하고 정상 워커에서 작업을 이어가는 로컬 라우터 통합 실험을 진행했습니다. 기본 구성과 멀티워커 구성을 각각 30회씩 비교했습니다.

| 지표 | 단일 커스텀 워커 | 커스텀 워커 2개 |
| --- | ---: | ---: |
| 중단 뒤 정상 커스텀 워커에서 세션 계속 | 0 / 30 | **30 / 30** |
| 기본 워커로 이동 | 30 / 30 | **0 / 30** |
| 교체 워커에 세션 고정 유지 | 0 / 30 | **30 / 30** |
| 워커 복구 뒤 정상 상태 확인 | 30 / 30 | 30 / 30 |
| 준비 상태 감지 p95 | 2,002.1 ms | 1,999.1 ms |

이 실험은 루프백 환경의 임시 MCP 워커와 2초 준비 상태 주기를 사용했습니다. 확인한 것은 워커 하나가 중단된 경우의 세션 복구 경로와 라우터 동작입니다.

### 구현 레퍼런스

| 확인 대상 | 링크 |
| --- | --- |
| 워커별 포트 설정 | [`src/config.ts`](https://github.com/enjoylonelines/devspace/blob/fix/mcp-resilience/src/config.ts) |
| MCP 준비 상태·요청 로그 | [`src/server.ts`](https://github.com/enjoylonelines/devspace/blob/fix/mcp-resilience/src/server.ts) |
| MCP 호환 입력 처리 | [`src/tool-surfaces/claude.ts`](https://github.com/enjoylonelines/devspace/blob/fix/mcp-resilience/src/tool-surfaces/claude.ts) |
| 회귀 테스트 | [`src/server.test.ts`](https://github.com/enjoylonelines/devspace/blob/fix/mcp-resilience/src/server.test.ts) |

## Sponsors and Special Thanks
<!-- 

<table>
  <thead>
    <tr>
      <th>Sponsor</th>
      <th>About</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" width="220">
        <a href="https://rebates.ai/">
          <img
            src="https://app.rebates.ai/brand/rebates-lockup.svg"
            alt="Rebates"
            width="170"
          >
        </a>
      </td>
      <td>
        <strong>The ads in your terminal pay you.</strong><br><br>
        <a href="https://rebates.ai/">Rebates</a> adds one optional
        sponsored footer to your coding agent and pays you cash back for every
        session in which it is shown. Turn it off at any time.
      </td>
    </tr>
  </tbody>
</table>
-->
<p>
  DevSpace is open to new sponsors.
  <a href="https://x.com/wshxnv">Get in touch to become one.</a>
</p>

## Installation

DevSpace requires Node `>=22.19 <27`.

Install the DevSpace CLI:

```bash
npm install -g @waishnav/devspace
```

Then initialize DevSpace:

```bash
devspace init
```

Or run it without a global install:

```bash
npx @waishnav/devspace init
```

During setup, DevSpace asks for:

- where you will use it: ChatGPT, Coding Agents, or both
- which agents DevSpace may use as subagents

The first choice is where you invoke DevSpace from. The subagent choice is
separate: ChatGPT or another coding agent can delegate work through DevSpace to
the agents you select there.

If you select ChatGPT, setup also asks which local project folders it may open
and for your public HTTPS base URL from Cloudflare Tunnel, ngrok, Pinggy,
Tailscale Funnel, or another reverse proxy. A Coding Agents-only setup asks
neither question: local commands use the current Git project, or the current
directory outside a repository.

Use the public origin without `/mcp` during setup:

```text
https://your-tunnel-host.example.com
```

You will configure your MCP client with the public `/mcp` URL after setup.
Run `devspace serve` when using ChatGPT. For Coding Agents, setup prints a
`skills` command and lets the Skills CLI handle installation.

When the client connects, DevSpace opens an Owner password approval page. Enter
the Owner password printed by `devspace init`. It is also stored in:

```text
~/.devspace/auth.json
```

Keep that password private.

## Connect Your MCP Client

The default local endpoint is:

```text
http://127.0.0.1:7676/mcp
```

Most users should connect through a public HTTPS tunnel:

```text
https://your-tunnel-host.example.com/mcp
```

> [!NOTE]
> Using DevSpace as an MCP connector isn't against OpenAI's Usage Policies — it's
> a standard custom App/connector setup, and writing or running code isn't a
> restricted use case. But your account is governed by your usage, not by
> DevSpace. Don't point it at anything that would violate your provider's terms.
> Used normally, you're fine. (Based on OpenAI's Usage Policies and Service Terms
> as of June 2026.)

## What ChatGPT Can Do

Once connected, ChatGPT can open one of your approved project folders as a
workspace. From there, it can inspect the repo, make scoped edits, run commands,
and show you what changed.

DevSpace gives ChatGPT tools to:

- read, write, and edit files inside the opened workspace
- search code and inspect directories
- run shell commands for tests, builds, git, and package scripts
- use isolated Git worktrees for parallel coding sessions
- follow project instructions from `AGENTS.md` and `CLAUDE.md`
- discover local agent skills from your skill folders
- show tool cards and optional change summaries in ChatGPT Apps-compatible hosts

## Mental Model

DevSpace is remote access to selected local folders.

You decide which roots are allowed. The MCP client still has powerful local
capabilities inside an opened workspace, including shell execution. Treat a
connected client like a trusted coding partner with access to your machine.

For a normal ChatGPT coding session:

1. Start your tunnel.
2. Run `devspace serve`.
3. Connect the MCP client to your public `/mcp` URL.
4. Approve the connection with the Owner password.
5. Ask ChatGPT to open a project inside one of your allowed roots.

## Platform Support

DevSpace supports Linux, macOS, and Windows environments with a Bash-compatible
shell.

| Platform                                          | Status            | Notes                                          |
| ------------------------------------------------- | ----------------- | ---------------------------------------------- |
| Linux                                             | Supported         | Requires Node, npm, Git, and Bash.             |
| macOS                                             | Supported         | Requires Node, npm, Git, and Bash.             |
| Windows with Git Bash, WSL, MSYS2, or Cygwin Bash | Supported         | Git Bash is the simplest native Windows setup. |
| Windows PowerShell or `cmd.exe` only              | Not supported yet | Install Git Bash or use WSL.                   |

Run this to inspect your local setup:

```bash
devspace doctor
```

## Documentation

- [Setup Guide](https://github.com/Waishnav/devspace/blob/main/docs/setup.md)
- [ChatGPT Coding Workflow](https://github.com/Waishnav/devspace/blob/main/docs/chatgpt-coding-workflow.md)
- [Configuration Reference](https://github.com/Waishnav/devspace/blob/main/docs/configuration.md)
- [Native File Download](https://github.com/Waishnav/devspace/blob/main/docs/artifact-exchange.md)
- [Security Model](https://github.com/Waishnav/devspace/blob/main/docs/security.md)
- [Troubleshooting Gotchas](https://github.com/Waishnav/devspace/blob/main/docs/gotchas.md)

## Philosophy

Every piece of software is becoming conversational. Natural language is
redefining how we interact with tools, workflows, and systems.

My bet is that ChatGPT becomes the operating system for everything. Once we
reach AGI, we will simply talk to ChatGPT, and it will prompt, coordinate, and
orchestrate sub-agents that set up the right loops for us.

We are not there yet.

DevSpace is one attempt to fast-forward that future: a way for MCP-capable
hosts like ChatGPT and Claude to work directly with local project files through
explicit, inspectable tools.

## Built by Waishnav

I'm Waishnav. I like building opinionated products and tools, and Artifacts is one example.

This year, I began my journey to build a one-person, multi-agent company capable of generating millions in revenue. If you want to follow the failures, wins, lessons, and everything in between, come hang out with me on [X](https://x.com/wshxnv).


## More from me

<table>
  <thead>
    <tr>
      <th>Project</th>
      <th>About</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" width="220">
        <a href="https://gitcms.dev/">
          <img
            src="https://gitcms.dev/brand/gitcms-logo.svg"
            alt="GitCMS"
            width="48"
          /><br />
          <strong>GitCMS</strong>
        </a>
      </td>
      <td>
        <strong>Modern CMS and tooling for markdown based content sites — built for agents and humans.</strong><br><br>
        Visual editing, editorial workflow, and ChatGPT/Claude content agents, with
        every post and page stored as files in your repo.
        <a href="https://gitcms.dev/">Learn more</a>.
      </td>
    </tr>
  </tbody>
</table>

## Local Development

For working on DevSpace itself:

Install pnpm 11.25.0, the version pinned in `package.json`, with
`npm install --global pnpm@11.25.0`, then:

```bash
pnpm install --frozen-lockfile
pnpm dev:seed
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`dev:seed` forks your normal DevSpace config and SQLite state into an ignored
checkout-local `.devspace-dev/` directory so source builds and migrations do not
modify your normal installation. Use `pnpm dev:reset` to discard that QA state
and fork it again. See [Development and Manual QA](docs/development.md) for
worktree switching, ChatGPT, and database-migration workflows.
