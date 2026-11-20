# FinPilot: Test Plan, Test Cases and Results

Version tested: `main` as of 2 November 2026 (production build, `next build --webpack`).
Environment: Windows 11, Python 3.12 (`.venv`), Node 20, Next.js 16.1.6, all backend services running locally.

**Legend**

| Mark | Meaning |
|---|---|
| **A** | Automated: repeatable with one command (see [How to run](#how-to-run)) |
| **L** | Run live with `curl` or the browser during this test cycle; evidence in the notes |
| **M** | Manual UI check: needs a signed-in session, to be executed by a team member (checklist in section 9) |
| PASS / FAIL | Result of the last run |

---

## 1. Summary

| Suite | Cases | Passed | Failed | Notes |
|---|---|---|---|---|
| End-to-end smoke (`npm run test:smoke`) | 58 | **58** | 0 | pages, market APIs, content APIs, security |
| CYRO agent + API + AI Baskets (`pytest tests/cyro_chat tests/baskets`) | 159 | **159** | 0 | includes 7 new API validation and isolation tests |
| Paper-trading service (`paper-trading/tests`) | 27 | **27** | 0 | new |
| News-feed service (`news-feed/tests`) | 14 | **14** | 0 | new |
| SEBI Shield / screener engine (`scrapper/tests`) | 5 | **5** | 0 | |
| Whole backend regression (`tests` + `web/cyro_engine`) | 1,325 | 1,309 | 16 | the 16 failures are legacy CLI and dependency-drift tests, none in code changed this cycle (section 7) |
| Type-check (`npx tsc --noEmit`) | n/a | clean | 0 | |
| Production build | n/a | success | 0 | `next build --webpack`, 39 static pages generated |
| Manual UI checklist | 41 | not run | n/a | needs a signed-in browser session (section 9) |

Regression baseline: before any change the backend suite reported 14 failed, 1,153 passed, 139 errors (the errors were a missing `firebase_admin` in the venv). After this cycle: 16 failed, 1,309 passed, 0 errors. The two additional failures are order-dependent tests in `tests/test_p0_fixes.py` that pass when run alone (27/27) and do not involve any file changed here.

---

## 2. Test cases: web pages (A, `scripts/smoke-test.mjs`)

| ID | Case | Expected | Result |
|---|---|---|---|
| PG-01 | `GET /`, `/home`, `/sign-in`, `/sign-up`, `/forgot-password` | 200 HTML document in under 3 s | PASS (7 to 137 ms) |
| PG-02 | `GET /cyro`, `/screener`, `/heatmap`, `/baskets`, `/invest-like`, `/compare`, `/chart`, `/company/TCS` | 200 HTML | PASS (7 to 22 ms) |
| PG-03 | `GET /news-feed`, `/results-calendar`, `/regulatory`, `/nifty-shorts`, `/shorts` | 200 HTML | PASS |
| PG-04 | `GET /paper-trading`, `/portfolio`, `/profile`, `/admin`, `/admin/users` | 200 HTML (client-side guard redirects anonymous users) | PASS |
| PG-05 | Unknown route | 404 | PASS |

## 3. Test cases: market data and content APIs

| ID | Case | Input | Expected | Type | Result |
|---|---|---|---|---|---|
| MK-01 | Market overview returns real values | `GET /api/market-overview` | at least 4 indices all with value > 0, 3+ sectors, non-empty breadth | A | PASS (7 indices; Nifty 50 matched the feed) |
| MK-02 | Live quote returns a live price | `?symbol=NSE_TCS` | `source=live`, `ltp>0` | A | PASS (TCS 2,501.70) |
| MK-03 | Live quote never invents a price | `?symbol=ZZZNOSUCHSTOCK` | `ltp=0`, `source=unavailable` | A | PASS |
| MK-04 | Live quote input validation | no symbol; `a b;drop` | 400 | A | PASS |
| MK-05 | Search returns live prices only | `GET /api/tv-search?q=tcs` | TCS present; any price formatted `₹x,xxx.xx`; no static table | A | PASS |
| MK-06 | Search hostile / empty input | `q=` ; `'; DROP TABLE x;--` | 200, no error, empty or harmless result | A | PASS |
| MK-07 | Chart candles | `/api/tv-chart?symbol=TCS&timeframe=D&range=30` | more than 10 candles | A | PASS (30) |
| MK-08 | Chart bad inputs | `timeframe=BAD&range=-4`; unknown symbol | 200 with defaults; 404 | A | PASS |
| MK-09 | Candles endpoint validation | `range=NOPE`; `symbol=../../etc` | 400 | A | PASS |
| MK-10 | Heatmap snapshot validation | no symbols; `not a symbol`; 200 symbols; valid pair | 400, 400, 400, 200 | A | PASS |
| MK-11 | Heatmap stream validation | no symbols; `bad` | 400 | A | PASS |
| MK-12 | Heatmap tab isolation | two streams share symbols, one closes | the other keeps receiving updates (per-owner subscriptions) | L (code review and unit logic) | PASS |
| MK-13 | Feed subscription cap | more than 800 distinct symbols | oldest evicted, memory bounded | L (code review) | PASS |
| CT-01 | News limit honoured | `/api/news?limit=5` | at most 5 results | A | PASS |
| CT-02 | News bad source | `source=XYZ` | 400 | A | PASS |
| CT-03 | News full list bounded | `/api/news` | at most 5,000 rows (was 12,900 and 5.7 MB) | A | PASS |
| CT-04 | Results calendar honest | `/api/results-calendar` | real rows or 503; never a "Seed" source | A | PASS |
| CT-05 | Results calendar params | `fromdate=bad` | 400 | A | PASS |
| CT-06 | Company profile | no symbol | 400 | A | PASS |
| CT-07 | Stock docs degrade gracefully | S3 credentials rejected | 200 `available:false`; no provider error text in the body | A | PASS |
| CT-08 | Shorts path traversal | `date=../../..`; `symbol=../x` | 400 | A | PASS |
| CT-09 | Baskets list / detail | list; unknown id; unknown symbol scores | 200 with baskets; 404; 404 | A | PASS |

## 4. Test cases: security

| ID | Case | Expected | Type | Result |
|---|---|---|---|---|
| SE-01 | 14 protected endpoints without a token (`/api/admin/*`, `/api/paper-trading/*`, `/api/user/*`, `/api/alerts`, `/api/cyro-market`, `/api/screener/*`, `/api/baskets/refresh`, `/api/cyro-agent/*`) | 401 each | A | PASS (14/14) |
| SE-02 | Forged admin session cookie `finpilot_admin_session=admin.9999999999.deadbeef` | 401 | A | PASS |
| SE-03 | Old client-side flag cookie `finpilot_admin_auth=true` | 401 (no longer trusted) | A | PASS |
| SE-04 | Admin login: invalid JSON, missing password, wrong password | 400, 400, 401 | A | PASS |
| SE-05 | Admin login with valid credentials sets an HttpOnly signed cookie; that cookie unlocks `/api/admin/users` and `/api/admin/health` | 200 + cookie, then 200 | L | PASS |
| SE-06 | Admin brute force | 9th attempt within a minute | 429 | L | PASS (attempts 1 to 8 gave 401, then 429) |
| SE-07 | Legacy paper-trading endpoints on the SEBI Shield service (`/api/portfolio/{id}`, `/api/trade/execute`) | removed: 404 | L | PASS (were unauthenticated; any user id could be traded) |
| SE-08 | `POST /api/baskets/refresh` anonymous | 401 (was able to start a heavy background job) | A | PASS |
| SE-09 | SQL-injection style input to news symbol / search / screener | treated as data, no error | A, L | PASS |
| SE-10 | Path traversal via `date` and `symbol` on `/api/shorts` | 400 | A | PASS |
| SE-11 | Cloud provider error text not echoed to the browser | no "AWS" / "Access Key" text | A | PASS |
| SE-12 | CYRO chat endpoints without a token | 401 | A (pytest) | PASS |
| SE-13 | A user cannot read, rename or delete another user's chat session or memory | 404 / empty | A (pytest) | PASS |
| SE-14 | Paper-trading API without a token | 401 | A (pytest) and L | PASS |

## 5. Test cases: backend logic and edge cases

### 5.1 Paper trading (`paper-trading/tests/test_api.py`, 27 cases, all A, all PASS)

| ID | Case | Expected |
|---|---|---|
| PT-01 | Valid trade, lowercase action `buy` | accepted, stored as `BUY` |
| PT-02 | Quantity 0, -3, 1,000,001, 2.5 | 422, database never called |
| PT-03 | Price 0, -1, above 10,000,000 | 422 |
| PT-04 | `NaN` price in the JSON body | 422 (previously crashed with HTTP 500) |
| PT-05 | Action `HOLD` or empty | 422 |
| PT-06 | Empty / 33-character ticker | 422 |
| PT-07 | Empty or 129-character idempotency key | 422 |
| PT-08 | Thesis above 4,000 / feedback above 8,000 characters | 422 |
| PT-09 | Insufficient balance | 400 with the reason in `detail` |
| PT-10 | Portfolio read | balance, positions and journal returned |
| PT-11 | No token on any endpoint | 401 or 403 |
| PT-12 | Mentor audit: quantity 0, bad action, empty ticker, score 101 or -1, thesis too long | 422 |
| PT-13 | Mentor LLM raises | 200 with a "failed, proceed carefully" critique |
| PT-14 | Next.js `execute` route surfaces the real reason (e.g. "Insufficient virtual balance") with a 4xx status instead of a generic 500 | code path verified; full flow M |

Transaction logic reviewed (no change needed): account row locked `FOR UPDATE`, idempotency re-checked after the lock, average price recomputed on buys, sells rejected above holdings, one transaction per order.

### 5.2 News feed (`news-feed/tests/test_news_api.py`, 14 cases, all PASS)

Limit below 1 or above 20,000 or non-numeric is 422; default is 5,000; source and index filters are normalised; invalid filters are 400; symbol endpoint capped at 5,000 and symbol length at 40; injection text is only ever a bound parameter; responses above 1 KB are gzip-compressed (5.7 MB to 433 KB).

### 5.3 SEBI Shield service (`scrapper`)

| ID | Case | Expected | Type | Result |
|---|---|---|---|---|
| RG-01 | `/v1/entities?page_size=0`, `-3`, `99999999` | 422 (was: empty, wrong slice, entire table) | L | PASS |
| RG-02 | `/v1/entities?page_size=5000` (value the UI uses) | 200 | L | PASS |
| RG-03 | `POST /v1/pipeline/run` while one is running | 409; runs off the event loop with a 30-minute limit and sanitised errors | code review + syntax check | PASS |
| RG-04 | `/v1/screen` malformed or empty bodies | 422 | L | PASS |

### 5.4 CYRO chat agent (`tests/cyro_chat`, 47 cases, all PASS)

Planning and routing; report decided by the agent and blocked by the `prefer_chat` preference; exactly one company for a report; memory learning, validation and per-user isolation; lowercase ticker resolution (`tcs`); a named company always fetches live data; numeric grounding (invented numbers regenerated then removed); earlier assistant text does not count as evidence; no-data answers cannot quote figures; LLM outage fallback; sessions isolated between users; HTTP validation (message 1 to 4,000 characters, title 1 to 120, memory key length, unknown memory keys and values rejected).

### 5.5 AI Baskets and screener (live, direct to backend)

| ID | Case | Expected | Result |
|---|---|---|---|
| BK-01 | Unknown basket id; null byte in id | 404 | PASS |
| BK-02 | Ranking with unknown model | 404 with the allowed list | PASS |
| BK-03 | Ranking `limit=999999`, `-1`; `cap=giant` | 422 | PASS |
| BK-04 | Scores for `tcs` (lowercase) and `'OR1=1` | 200 / 404 | PASS |
| BK-05 | Summary with unknown model | 404 | PASS |
| SC-01 | Screener `limit` 0 / 99,999,999, negative offset | 422 | PASS |
| SC-02 | Unknown sort field, unknown field, invalid operator (`DROP`) | 400 | PASS |
| SC-03 | Search with SQL text; symbols filter; malformed JSON; `conditions` not a list | 200 (no match) / 200 / 422 / 422 | PASS |

## 6. Performance

Measured on a production build, warm unless stated. Before-figures come from the dev server before the fixes.

| Item | Before | After | Cause and fix |
|---|---|---|---|
| Live quote API | 2.1 s, timed out and returned empty | 0.13 s | TradingView client was bundled by webpack, which broke its websocket; marked as an external server package |
| Chart API (candles + quote) | 5.7 s, zero candles | 0.27 s cold, ~0.07 s warm | same fix; candles cached 5 minutes |
| `/api/news` payload | 5.7 MB, every poll | 433 KB gzip (cap 5,000 rows) | row cap and gzip |
| Stock docs when S3 is down | 2.8 s on every page view | instant after the first failure (60 s back-off) | negative cache |
| Home page market numbers | static strings | live, shared poller (one request per 15 s for the ticker and the home page together) | `/api/market-overview` with a 5 s server cache and request coalescing |
| Market overview cold start | n/a | about 1.5 s first call, 15 ms cached | sparkline fetch limited to 1.2 s, filled in on the next poll |
| Page HTML (production) | 3 to 6 s per first visit in dev | 7 to 22 ms | production build removes on-demand compilation |
| Background tabs | quotes polled every 1.5 s, portfolio every 6 s | polling pauses while the tab is hidden | `visibilityState` guards |
| Heatmap stream | stopped permanently after one network error | reconnects with backoff | client hook |
| Build | Turbopack panic under memory pressure | stable | `next build --webpack` |

JavaScript payload: 3.1 MB total across 104 chunks; largest chunk 352 KB; heaviest page chunk (`/heatmap`) 112 KB.

## 7. Defects found and fixed in this cycle

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | **Critical** | `/api/admin/users` and `/api/admin/health` answered anyone, returning user names, emails, IP addresses and locations | server-verified admin login, signed HttpOnly session, login throttling |
| 2 | **Critical** | SEBI Shield service exposed unauthenticated paper-trading endpoints keyed by a caller-chosen user id | removed (no callers) |
| 3 | **High** | Hard-coded "live" numbers: index ticker, benchmark cards, sector bars, Nifty breadth, VIX, trending chips, search prices, and a hash-generated price for unknown stocks | all replaced with live feed data; placeholders show an em dash while loading |
| 4 | **High** | `live-quote` returned invented fallback prices that fed order estimates | returns `ltp 0 / unavailable` |
| 5 | **High** | TradingView calls timed out inside Next.js, so charts, quotes and search prices were empty or slow | external package setting |
| 6 | **High** | Path traversal through `date` on `/api/shorts` (also copied files outside the folder) | strict date and symbol validation |
| 7 | **High** | Results calendar served invented result dates when BSE was unreachable | 503 or last real data |
| 8 | Medium | Anonymous users could start the baskets refresh job | sign-in required |
| 9 | Medium | Trade errors shown as a generic "Execute failed" with HTTP 500 | real reason and 4xx status surfaced |
| 10 | Medium | `NaN` in a request crashed FastAPI's error response (HTTP 500) | safe validation handler |
| 11 | Medium | Unbounded inputs: news (12,900 rows), entities, chat message, titles, trade size and text | limits on every one |
| 12 | Medium | Closing one heatmap tab unsubscribed symbols other tabs and the ticker used; no subscription cap | per-owner subscriptions and a cap |
| 13 | Medium | Pipeline run endpoint blocked the whole API for minutes and had no timeout or single-flight guard | thread offload, lock, timeout |
| 14 | Medium | S3 failure leaked the AWS error text and cost about 3 s per call | generic message and back-off |
| 15 | Low | Heatmap stream never reconnected; background tabs kept polling | reconnect and visibility guards |
| 16 | Low | `requirements.txt` lacked `langchain-openai` and `chromadb`, which broke research reports on a fresh install | added |
| 17 | Low | Dead code (old sidebar, top bar, unused routes and images) | removed earlier in the cycle |

## 8. Known issues and limits (not fixed, documented)

* **16 failing legacy tests.** `tests/test_api_broker.py` (5), `tests/test_agent_core.py` (4), `web/cyro_engine/tests/test_investment_committee.py` (4, an `aiohttp.SocketTimeoutError` attribute removed in the installed `aiohttp`), `tests/test_p0_fixes.py` (2, pass alone, fail in the full run due to test order), `test_macro_peer_integration.py` (1, a mock returns a `MagicMock` where JSON is expected). They test the original CLI or mock internals; the corresponding live features were exercised end to end (a full TCS research report completed with all analysts and the committee).
* **Database host not resolvable from the test machine.** The Neon PostgreSQL host failed DNS resolution during this cycle, so database-backed flows (profile, preferences, alerts, saved portfolio, a real BUY/SELL) could only be validated through unit tests with fakes, not against the live database. Re-run the manual checklist once connectivity is available.
* **Two `DATABASE_URL` lines in `.env`.** The later one wins; keep only the intended one.
* **S3 credentials rejected**, so company document insights show "temporarily unavailable".
* **Admin credentials default to the built-in pair** unless `ADMIN_USERNAME` / `ADMIN_PASSWORD` are set. Change them before any shared deployment.
* TradingView and NSE/BSE endpoints are unofficial public feeds; availability is outside our control.

## 9. Manual UI checklist (M): run signed in, production build, desktop and phone width

| # | Area | Check |
|---|---|---|
| 1 | Sign-in | Email sign-in, Google sign-in, wrong password message, forgot-password email, redirect to `/home` |
| 2 | Sign-up | Account creation, validation messages, redirect |
| 3 | Navigation | Every top-bar link opens the right page; active tab highlighted; mobile menu works; theme toggle persists |
| 4 | Ticker | Scrolls smoothly, shows real Nifty/Sensex/Bank Nifty/VIX values, shows "Loading live market data" briefly on first load only |
| 5 | Home | Four benchmark cards with sparklines and H/L; sector bars; breadth bar totals 100%; trending chips clickable; no layout jump after data loads |
| 6 | Home search | Typing `tcs` shows live price/change; Enter and click open the dashboard; unknown text shows no fake price |
| 7 | Stock dashboard | Chart loads with candles, timeframe buttons work, quote ticks, indicators, fundamentals, company profile, "documents unavailable" message does not break the page |
| 8 | Compare | Add two stocks, remove one, bad symbol message |
| 9 | Screener | Presets show counts, adding/removing conditions, sorting, search, paging, empty result message |
| 10 | Heatmap | Index switch, gainers/losers filter, tiles update live, tab switching and returning keeps data, refresh after network drop |
| 11 | AI Baskets | List loads, basket detail chart, range switch, stock drill-down, Refresh button asks you to be signed in only when signed out |
| 12 | Invest Like | Switch each investor model, ranking, cap filter, stock summary |
| 13 | CYRO chat | Starter cards; ask "is TCS expensive right now" (price matches the chart page); rename, delete, search a chat; toggle chat list and sources panel; Memory tab edit and "forget everything" |
| 14 | CYRO report | Ask for a full report on one company; research steps stream; report renders; reload the chat and the report is still there |
| 15 | CYRO safety | Ask about a company with no data (e.g. a delisted name): no invented numbers appear |
| 16 | Paper trading | Portfolio loads; BUY within balance fills at the live price; BUY above balance shows "Insufficient virtual balance"; SELL above holdings is refused; journal updates; mentor critique appears; double click does not trade twice |
| 17 | Portfolio | Add/remove holding, totals correct, chart |
| 18 | News feed | Loads fast, filters (source, index, category), search, page size, auto-refresh does not reset the page |
| 19 | Results calendar | Rows load; if BSE is down a clear error plus the last cached rows; no invented dates |
| 20 | SEBI Shield | Entity list loads, screening a name returns match/no-match, "Run pipeline" shows progress and handles a second click |
| 21 | Nifty Shorts / Shorts | Cards load, video plays, generate shows progress |
| 22 | Alerts | Bell shows alerts, mark read persists |
| 23 | Profile | Edit name, preferences save and persist after reload |
| 24 | Admin | Admin login from the sign-in page; Admin Home shows subsystem health and ping; User Activity lists users; sign out returns to sign-in; direct `/admin` when signed out redirects |
| 25 | Resilience | Stop the CYRO backend: pages show a clear message and recover when it returns; stop the paper-trading service: Paper Trading shows Retry and recovers |
| 26 | Responsive | 360 px, 768 px and 1366 px widths: no horizontal scroll, no overlapping text |
| 27 | Console | No red errors in the browser console on any page |

(Items 28 to 41 repeat items 1 to 14 on a phone-width viewport.)

---

## How to run

```bash
# end-to-end smoke (needs the stack running, no login)
npm run test:smoke

# backend suites (from the repository root, venv active)
cd india-trade-cli && python -m pytest tests/cyro_chat tests/baskets
cd paper-trading   && python -m pytest tests
cd news-feed       && python -m pytest tests
cd scrapper        && python -m pytest tests

# full backend regression
cd india-trade-cli && python -m pytest tests web/cyro_engine

# static checks
npx tsc --noEmit
npm run build
```
