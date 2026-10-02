# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 (2026-10-02)


### Features

* **#296:** add storage config constants, get_config view, and docs/c… ([c559292](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/c5592922b1cda7ec6f1291a0bf2c11048c77ed25))
* **#311:** add stream_status view returning typed StreamStatus enum ([9dfbc89](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/9dfbc8960497a7bf2961bc69a7048c9ee53e8dad))
* **#575:** implement fee collection mechanism ([02d15e9](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/02d15e91d709c03bf9f3920967d25d33707e741a))
* **#575:** implement fee collection mechanism ([652c251](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/652c251c606ba576cc4a79ef6a3aeae55db81906))
* **#575:** implement fee collection mechanism ([aaf6d0d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/aaf6d0d376f94d7e395205ef86b1ca2b447f6448))
* **#575:** implement fee collection mechanism ([eb753ba](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/eb753ba534274a801523531698006ddf63cb9f5c))
* **#717:** add variable-rate segment tests and document storage layout in ADR-0009 ([6befe86](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6befe862e2cd0337cba2525d0c48ede279957c65)), closes [#717](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/717)
* **#719:** implement pause_stream and resume_stream entry points ([8b282bd](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8b282bdff8ad10c72a2046baed112988e089b822)), closes [#719](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/719)
* **#720:** implement recipient allowlist mechanism ([6236d28](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6236d282c2005034d9041f2aa040766bb5eae285)), closes [#720](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/720)
* **#721:** add optional metadata field to create_vesting_stream ([a9f9953](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/a9f99533e89dafcb389e6699bae01a232f3cbcc5)), closes [#721](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/721)
* **#726:** add test_init.rs with initialize acceptance tests ([da2874a](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/da2874a1d5bf51413de9266408a306838928e4da)), closes [#726](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/726)
* **#727:** add keeper_bump permissionless TTL refresh and update ADR-0005 ([eab0b5d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/eab0b5d5dc0ed9a6c9484cc78ea55350b5e6ba9d)), closes [#727](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/727)
* **#768:** implement public stream explorer page with search, filter, sort and pagination ([b899a2f](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/b899a2f59a49fe1f40fa234c8e3aae46d7f46d58)), closes [#768](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/768)
* **#770:** redesign mobile navigation with bottom tab bar and hamburger menu ([a623496](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/a623496f6215aed859d96146f8e8688de6e1a320)), closes [#770](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/770)
* **#778:** add property-based tests for claimable_amount ([0b02d7d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/0b02d7d70e82ae536b31930ae9f60cdc7a4cda9d))
* **#779:** add integration tests for full stream lifecycle against local Stellar node ([dd8884e](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/dd8884e59696332ff84c2a16d59755a4505fb33f)), closes [#779](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/779)
* **#780:** achieve 95%+ mutation test score for contract core logic ([86d6292](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/86d62922ebc1bb8242869b76bf5ab8da74e18b26)), closes [#780](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/780)
* **#786:** add regression tests for all VestingError codes (1-26+) ([d388e65](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/d388e654320c278de30e51cdbc9af388d2cc1b45))
* **#791:** add Pact consumer-driven contract tests ([c7e6e83](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/c7e6e83c39e3aaf3b7eecdb7e0819dfa61c3520e)), closes [#791](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/791)
* **#808:** add a cargo-deny allowlist and document SPDX generation ([3cd2cae](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/3cd2cae0c976c546fd4210e780eb0ed4ec894f55)), closes [#808](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/808)
* **#819:** implement the five empty states with accessible illustrations ([a8575ec](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/a8575ecc6b961964f79544119574d5aff723a96e)), closes [#819](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/819)
* **#820:** add first-time-user onboarding tour ([6767da5](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6767da5b3189a17fa5b9ff0a37a661c33f077ec3))
* **#820:** add first-time-user onboarding tour ([fc9b263](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/fc9b26396ec8ddf4148367c527779b166130b8ce))
* **#821:** map all 26 VestingError codes to actionable messages ([dfc88c4](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/dfc88c41efa6309b676d1eecf0dd6713aadebc9a))
* **#821:** map all 26 VestingError codes to actionable messages ([5fc131a](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/5fc131a5c42e2c8b8d6fcf3e4b14ec97f2f840ed))
* **#822:** make the create-stream wizard mobile-first ([97a1062](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/97a1062136a757508469629b00201c62dae44e45))
* **#822:** make the create-stream wizard mobile-first ([aeb09e7](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/aeb09e7890889c8cb03a44112c99a7bc4a642dce))
* **#823:** add skeleton screens for all data-fetching views ([40efc2b](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/40efc2bb168182709cb053a59ec21a62d874a83e))
* **#823:** add skeleton screens for all data-fetching views ([7333271](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/7333271b54eead99148e31a126d3d1d4fe70cf63))
* **#825:** add transaction review summary to signing dialogs ([07da3ec](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/07da3ec40ccbe6d479f51fbc7c1a636ddebf43e5))
* **#826:** add stream acknowledgment flow ([29c3c10](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/29c3c109423e596cba4be2dbd1f41025cfa37bc2))
* **#827:** add responsive sortable data table ([1eada04](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/1eada0496387e012cd206e4da23186d83d0b0ee8))
* **#828:** add progressive stream creation form ([5ad2141](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/5ad2141993ccd2280d957eab866604acdbe00f05))
* **#829:** add accessible cliff countdown ([1171ddc](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/1171ddc2349ffa2c4d3c7c8734d525ccce939013))
* **#831:** add Figma design handoff manifest ([804daa1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/804daa1170c68edab03a46b8549b976050638303))
* **#832:** add multi-stage CI/CD pipeline ([9e3aa51](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/9e3aa517c762aa0accbd47c094d6bd76fdd23ffd))
* **#833:** migrate Terraform state to S3 with DynamoDB locking ([0afb90a](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/0afb90a01d60c33ba5da36a999031c23fc386c46)), closes [#833](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/833)
* **#834:** add scheduled Terraform drift detection with issue alerting ([d15ef40](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/d15ef401d3287b52654f45371298158be70b7b5d)), closes [#834](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/834)
* **#838:** migrate application secrets to AWS Secrets Manager with r… ([29d4d97](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/29d4d97f316174cb6fc42f0b205faae8abc5c87c))
* **#838:** migrate application secrets to AWS Secrets Manager with rotation ([658a8e1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/658a8e1c703fdd643448b43486a09bf9d0445bbd)), closes [#838](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/838)
* **#839:** add cost monitoring, budget alerts, monthly report and In… ([815a0e6](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/815a0e67394f39827a54a2626e6e740cc671def2))
* **#839:** add cost monitoring, budget alerts, monthly report and Infracost ([cde0f9d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/cde0f9d5b6baf6402b7b4b33a94f0688d66bed6a)), closes [#839](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/839)
* **#840:** add log aggregation pipeline with Fluent Bit, metric filt… ([34999e8](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/34999e865a375546464dfa009aeb5a98d43dca26))
* **#840:** add log aggregation pipeline with Fluent Bit, metric filters and PagerDuty paging ([e413d0d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/e413d0d3d0f0c47cf2a4ef18eedfdff07e4e5c3b)), closes [#840](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/840)
* **#841:** add a dependency-free PostgreSQL client for the restore check ([83acad4](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/83acad4ab8511b0209ac6e7a28956b1066459277)), closes [#841](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/841)
* **#841:** verify RDS backups restore on a weekly schedule ([f7f87f6](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/f7f87f6f018db54ba4dd9b6bd46108d204407315)), closes [#841](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/841)
* **a11y:** audit and fix WCAG 2.1 AA ARIA violations on all form components ([5fc54ed](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/5fc54ed66e09d296facffd0a8f8325659b60f5a3)), closes [#772](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/772)
* **a11y:** keyboard navigation and focus management ([#389](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/389)) ([ca088cc](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ca088cc941b45726669893cde26ffda070d7e5c0))
* add advanced vesting schedule support ([8dd005c](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8dd005cee858c7740f2db356c368545b74473894))
* add AWS WAF protection ([#837](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/837)) ([c6aadaf](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/c6aadaf2a84f5f66a253800cb54e1429aacb8e0f))
* add AWS WAF protection ([#837](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/837)) ([9aaa780](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/9aaa780557d755286475a9f364c39fe04f3e53c2))
* add batch claimable view ([#728](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/728)) ([43ab667](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/43ab6674daac7ef0e04ed93a0717b9babfb487d5))
* add ConfigMaxCliffRatio/ConfigMinRate DataKey variants, storage helpers, set_config/get_config, and runtime validation in create_vesting_stream ([ea91f5c](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ea91f5c560d69cad31bebff3ee7ce54b4339f527))
* add cost anomaly alerting with ECS/RDS monitors and Slack relay ([#566](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/566)) ([7dd3266](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/7dd3266415d08ab1c74859b2917cc9ed8329b7ba))
* add CSV and JSON export endpoints for stream data ([#297](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/297)) ([348d0a5](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/348d0a5ebe172ac7e7fe8f2db897806f5cf305db))
* add ECS blue-green deployments ([#836](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/836)) ([1201ca5](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/1201ca540988a135d0682b1d13c6210bff3009b4))
* add ECS blue-green deployments ([#836](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/836)) ([8c57d02](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8c57d029367e75d8b93ef9c44ede4dfebc5c9b57))
* add ErrorBoundary with Sentry integration for uncaught React errors ([#545](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/545)) ([6fff687](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6fff687181178bc52318626efa5e204561b44f41))
* add full dark mode support with OS preference detection and 200ms transitions ([#273](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/273)) ([8313f96](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8313f96c7f8e52acc28512dcb7234842d3893607))
* add GET /api/analytics/summary endpoint with Redis caching and background job ([40453a3](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/40453a351f1bdbca2777c369a1adcfbd7fc2d47b)), closes [#745](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/745)
* add Horizon API status banner ([#278](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/278)) ([338f44b](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/338f44b192dfaf54a98a236207f9355fbdd5c98e))
* add immutable admin audit log ([da41fa4](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/da41fa4dc48840921143379ceaeb72ba2e3954d5))
* add insta snapshot tests for all 5 contract event types ([#784](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/784)) ([bad1662](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/bad1662549d85e63a8d1fe3b9ecd8fc8469e913a))
* add InvalidToken error code 12 with SAC try_balance validation … ([70c8ed4](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/70c8ed4496014968d2d814662df95b7115852e27))
* add InvalidToken error code 12 with SAC try_balance validation closes [#9](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/9) ([a27a466](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/a27a466c96f9c5f1f6047ff47280df18f9480c37))
* add migration rollback support with CLI scripts and tests ([#561](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/561)) ([58a37ee](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/58a37ee85e3a7cd2dc4f7fff0802a1fd771f53cb))
* add multi-token vesting stream support ([8aad448](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8aad448f9d741617cd15e96122cc8113921ccb6a))
* add multi-token vesting stream support ([effd8f8](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/effd8f8054cb7cf9e41ac7d6f1b69c593a78f000)), closes [#587](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/587)
* add OpenAPI 3.1 spec, Spectral CI, and Swagger UI endpoint ([e923995](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/e923995ce5b8f8cf90a5e7ce68864339f66bb791)), closes [#750](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/750)
* add POST /admin/backfill endpoint with idempotent upsert and progress tracking ([07b4b27](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/07b4b27c94472006937f2d30ab16efc09407d066)), closes [#749](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/749)
* add precise token amount input ([#830](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/830)) ([06d88d6](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/06d88d6b73e2fdd0dc342ffc93085777a90f31c3))
* add precise token amount input ([#830](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/830)) ([f7e14ab](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/f7e14ab713f74d69ba5a1999fb60effca8db9b21))
* add pytest smoke test suite for post-deployment validation ([#793](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/793)) ([f1c91b8](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/f1c91b8bd893902f7db6e58ddc45d5588bb807e8))
* add security test suite for authentication bypass ([#783](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/783)) ([53e2dd8](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/53e2dd83b3d891c8d22f92e18cd38d20e6e40245))
* add service worker for offline support ([ea8771e](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ea8771eeba5a0ee1c29b0f2273f400981c1fe59c))
* add service worker for offline support ([60a69fe](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/60a69fe340f7926d6dd9eb00c3508d1dc68bea56)), closes [#539](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/539)
* add transfer_recipient to reassign vesting streams ([ff7f7d8](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ff7f7d83b1ea7ac22c54096f426a7d21a655421b))
* add WASM size regression test ([#794](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/794)) ([6ab1e2b](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6ab1e2b1b8df95526791f0db37669a926d14c62c))
* **admin:** add admin API with Bearer token auth ([6fee3b5](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6fee3b568be2b199fdb7a999248ab460e70c26a7))
* **analytics:** implement full event tracking for issue [#546](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/546) ([dbd8b21](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/dbd8b21c23aefa4d71b884d3922c7c3441fb2b31))
* **analytics:** implement full event tracking for issue [#546](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/546) ([cf05f0e](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/cf05f0e83b2c62eb22b978635e98b6d7c561b645))
* **api:** list sponsor streams ([d44a27d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/d44a27ded2233937d758501124e0c024873aa2d1))
* auto-cleanup completed streams to reclaim rent ([b41fc13](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/b41fc13f00da845d3289de467947c14a75396963))
* auto-cleanup completed streams to reclaim rent ([#12](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/12)) ([256dcb0](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/256dcb03e4c27f7d839f8b548b18623e0d35d2a0))
* auto-cleanup completed streams to reclaim rent ([#12](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/12)) ([266c53f](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/266c53ffbe638ef9e70e56292240ebbd68fd8e48))
* **backend:** add pg connection pool with Prometheus metrics and health checks ([dea39a7](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/dea39a7a037a743a9c77b7f545c909037f845dbe))
* **backend:** add pg connection pool with Prometheus metrics and health checks ([b0a445c](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/b0a445c978ac7f5bc11421a62ff47c73672b12ea)), closes [#555](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/555)
* **backend:** add POST /api/streams/:recipient/build-claim-tx endpoint ([0e96456](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/0e96456bf21d9a94b410ebe49c549409aed6a880)), closes [#743](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/743)
* **backend:** add stream details and operational safeguards ([a357e58](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/a357e58caab5af0d8c308b81386c3d1df52cfab9))
* **backend:** add WebSocket endpoint for real-time stream events ([19cbea6](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/19cbea6f1ef1f5e7e872b3cc1f49e9d5a81369b4)), closes [#740](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/740)
* **backend:** add Zod request validation for all API endpoints ([d44df5e](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/d44df5e2a8d442df6d9164ccb7b7edc0cf43af84))
* **backend:** cache Soroban RPC view calls with per-function TTLs ([70274e9](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/70274e9028ca9b261a4536805dd233d20b5e6574)), closes [#29](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/29)
* **backend:** cache Soroban RPC view calls with per-function TTLs ([0715037](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/0715037a68cb9a4268483d0c62d66beb006aa007)), closes [#29](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/29)
* **backend:** implement GraphQL depth and complexity limits ([678313b](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/678313b710bd1372edb9d2c6e82f87b4e696fe28))
* **backend:** implement GraphQL depth and complexity limits ([57bdfc1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/57bdfc14527932af2858d04be6508b764011376d)), closes [#553](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/553)
* **backfill:** implement backfill_stream_events.ts ([#286](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/286)) ([78389f6](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/78389f6b81a97a426238f869c3fcb434ea6cac19))
* build sponsor stream creation form with validation ([b1beb26](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/b1beb264b92cfeead89c1c996d2a7b6ab8deacd8)), closes [#759](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/759)
* build vesting timeline SVG/Canvas React component ([d78662d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/d78662db6b195f4e8154fc526a547d08947d9745)), closes [#761](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/761)
* build vesting timeline visualization component ([549c463](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/549c463013d7fb8c7329974ed6c103ccda86916b))
* **cache:** add Redis caching for Soroban view functions ([f18233a](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/f18233aa2020d135271a46fdc99d622b94ae51b1))
* **cancel-modal:** add CANCEL-typed confirmation gate for issue [#550](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/550) ([bf43c6f](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/bf43c6f12cf2827d1defd587a97842e548326fd3))
* **cancel-modal:** add CANCEL-typed confirmation gate for issue [#550](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/550) ([b30a354](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/b30a3544a14558bd96f3afd295337a6a3d731052))
* **ci:** add coverage reporting pipeline with threshold enforcement ([#785](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/785)) ([78983d7](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/78983d741424836567dff72d89c629b5e31b9b1f))
* circuit breaker for horizonGet with /health state exposure ([1ff33af](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/1ff33af09f9d97f2bb52a7689cc1da67668c4444))
* circuit breaker for horizonGet with /health state exposure ([9f18c6a](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/9f18c6a2504cadf2edc20f0c8bb2be744ef3ea5b))
* complete backfill_stream_events.ts with CLI args, pagination, progress bar ([49b8ce2](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/49b8ce217afac273111002792abc259f3cfd9cc7))
* complete OpenTelemetry tracing implementation ([31e8efb](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/31e8efb73eb32e17e679eef89e668f30ee0f483f))
* complete OpenTelemetry tracing implementation ([40eb383](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/40eb3833cf3fb7c827e57e67ecf3e07248140b0c))
* comprehensive smoke test suite for post-deployment verification ([5318e88](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/5318e88cec49517856e6f606786befaf99035df7))
* configurable constants max_cliff_ratio and min_rate via set_config/get_config closes [#11](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/11) ([0c60e68](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/0c60e6803e3eeee772b6245cce35fe171ba9e0fa))
* **contract:** add pause_stream and resume_stream entry-points ([f6fb1ae](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/f6fb1aedd7e5883c92c296174ba4d1a1721a3896)), closes [#3](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/3)
* **contract:** add stream_status() view function for on-chain lifecy… ([49cb350](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/49cb3503fbe329824fbc51fdffab2ad0a5a98f55))
* **contract:** add stream_status() view function for on-chain lifecycle state ([#583](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/583)) ([7c22baa](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/7c22baa114a7653d938911800e18f30e60e95e7a))
* **contract:** harden clawback with SAC flag check and sponsor valid… ([64ee93b](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/64ee93b6264c786d23a4c995f2685aa49a5b4e8b))
* **contract:** harden clawback with SAC flag check and sponsor validation ([#584](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/584)) ([80c6a18](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/80c6a186ad38cbe1d07be3f81278b3e472b1d301))
* **dark-mode:** add data-theme attribute strategy and ThemeProvider ([#766](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/766)) ([78b7d73](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/78b7d73365edde9719d36cd8693986f6c3a177eb))
* dashboard stream management — sort, filter, table view ([#277](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/277)) ([1a00bf7](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/1a00bf72feb02466313b511dffab751d16fc3610))
* **db-tests:** add PostgreSQL integration test suite with testcontainers ([#792](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/792)) ([61b2e6d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/61b2e6d9e27e291e69f7c948a712ef61f34f95ee))
* **design-system:** establish design tokens, component stories, and CSS linter ([6a24d74](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6a24d74316522b9d78d81a561f70dce7e5296cf6)), closes [#817](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/817)
* enforce recipient allowlist ([#720](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/720)) ([85c2e01](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/85c2e015a1b6286df053e79c914f130117a6166a))
* enhanced React Error Boundaries with per-card boundary and Sentry hook ([#275](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/275)) ([cb57eed](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/cb57eedc060411ac9c5af0028a102e3fc74eb029))
* extend dashboard with sort/filter/table view ([#277](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/277)) ([d6fe663](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/d6fe663f34ac4a1f0173323194591f9d55379866))
* fixed-point rates, cliff ratio guard, stream transfer, cancel event ([ccd2b17](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ccd2b178d1396f3091a09c028cb1e010942f633e))
* fixed-point rates, cliff ratio guard, stream transfer, cancel event ([bdcb760](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/bdcb760980f75fd10cb64aa168afb04bbae25017))
* **frontend:** add claim button with full tx state machine to stream cards ([711c47a](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/711c47aa9521d9955aabd6ddd7e07cc61669ad20))
* **frontend:** add claim button with full tx state machine to stream… ([6853632](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6853632d460aa11adfe8ed5dbdcfa20b156c63fc))
* **frontend:** add ErrorBoundary with Sentry integration for uncaught React errors ([ade4e1e](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ade4e1e8be6bd5c0902ad4a8e16f05ae5a535183))
* **frontend:** add skeleton loading states for all async data fetches ([bda50ff](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/bda50ffad7c0f588254cc269ae1553d3f1ee4580))
* **frontend:** add skeleton loading states for all async data fetches ([dd07117](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/dd0711726fd2b83764177d096dd6e03e1d8c7d12)), closes [#549](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/549)
* **frontend:** add StreamStatusBadge with all 6 lifecycle states ([af1a4f8](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/af1a4f835222e71e989f54efc7c1c31ec2a655b8))
* **frontend:** add SVGVestingTimeline component for vesting stream phases ([bafc45f](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/bafc45f343fe2186e234ad497a923c4382a76fa3))
* **frontend:** add SVGVestingTimeline component for vesting stream phases ([83a74c3](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/83a74c343bc45bf6c3eca8bd285baa5e944998fc)), closes [#271](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/271)
* **frontend:** add TransactionHistoryPanel with Horizon event stream ([0707ff4](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/0707ff41ee82b10ad43b5f4d99a460c238cad338))
* **frontend:** add TransactionHistoryPanel with Horizon event stream ([5225e21](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/5225e211fcf6c39ceabf3bdab610ea1847416239)), closes [#272](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/272)
* **frontend:** admin panel UI for contract configuration management ([#774](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/774)) ([2295ef1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/2295ef1e2031774e6ac06d45df4d1a23912de911))
* **frontend:** Cypress E2E test suite for claim flow ([#775](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/775)) ([cce4b00](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/cce4b00c5a56d6f95dab5f7b5045d381025f1ca1))
* **frontend:** extend KeyboardShortcuts with full dashboard shortcuts and overlay ([bf8defd](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/bf8defd6431a653e54c136d9bc80dcbe8919767f))
* **frontend:** extend KeyboardShortcuts with full dashboard shortcuts and overlay ([c87f49e](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/c87f49e6bc3420879ccb744540d3b2bfc1f0405c)), closes [#270](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/270)
* **frontend:** implement glossary tooltip system for technical terms ([aa41ae1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/aa41ae130b693f18ee8c61c90dec9593ab43db63))
* **frontend:** implement mobile claim bottom sheet with E2E tests ([a968e65](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/a968e65fd0c2462a18ed5215e6d6084576299d4a))
* **frontend:** implement mobile claim bottom sheet with E2E tests ([#542](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/542)) ([6d37935](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6d37935393afba4530d02b7a5b58d8b1efb71193))
* **frontend:** implement onboarding tour for first-time users ([8ec0df8](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8ec0df818a8912ff2708586e4a061f2add66d63b))
* **frontend:** implement print stylesheet for stream summary ([6a4e687](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6a4e687bdc52b04aab144c6597717d44b6745ea2))
* **frontend:** implement print stylesheet for stream summary ([#541](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/541)) ([29eb7dc](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/29eb7dc8233095241102852328d02d650d0be830))
* **frontend:** implement StreamStatusBadge with all 6 lifecycle states ([#543](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/543)) ([3b8b429](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/3b8b429a3cab0a77b7cd15a4081696a4ce110c84))
* **frontend:** migrate component styles to CSS Modules ([c70165d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/c70165d908fb5d75dc5219f4458acfe0158d8e0f))
* **frontend:** migrate component styles to CSS Modules ([#540](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/540)) ([511f47d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/511f47d388af728af1e70fd7c51d4a929eeec2c4))
* **frontend:** Sentry integration for error tracking and performance monitoring ([#773](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/773)) ([4bc33c8](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/4bc33c88178c93b085589913ecca7fb9fae65f07))
* **frontend:** stream cancellation UI with sponsor confirmation ([#776](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/776)) ([5141f1e](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/5141f1edeb03ec9a00e9daacdbc21699ba85f056))
* **frontend:** stream dashboard page with wallet integration and claim flow ([36f06a6](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/36f06a6e180aeaf5ab470b6caac1d04bdf837287)), closes [#757](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/757)
* full dark mode support with OS preference and 200ms transitions ([d304af9](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/d304af9807f7aacba1062caf38a6f169c669c577))
* **fuzz:** add fuzz testing for create/claim/cancel ([#777](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/777)) ([f44a90b](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/f44a90bbc4697c835393c2b0acf47e70f7b297b2))
* Horizon API status banner ([#278](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/278)) ([072d3c6](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/072d3c6431a3b42fbe07946edfad6b0e55059f9c))
* i18n framework with EN/ES translations ([#280](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/280)) ([93155f8](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/93155f84113e6cd7cb3a53993476748b3ff1d14f))
* i18n framework with EN/ES translations ([#280](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/280)) ([b675390](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/b6753909be87f13f6e01771908e680ecb9247e04))
* **i18n:** add Portuguese locale and lazy-load translation files ([#767](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/767)) ([a0dfe3b](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/a0dfe3bb26bde9496599c46fcfc5c2476ec5e674))
* implement centralized request validation middleware ([0d71327](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/0d7132777365e70dbe6f2d1aadcdc766f7e1ee79)), closes [#752](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/752)
* implement GET /streams/:recipient/versions endpoint ([319a5da](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/319a5da8bd87f433e2c6f30c9395146041ada0d7))
* implement GET /streams/:recipient/versions endpoint ([3987656](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/398765622100115dab968204864f9ce5eeb83bc7))
* implement GET /streams/:recipient/versions endpoint ([9acc750](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/9acc750c126de737763f982ed7bde2f902551067))
* implement glossary tooltip system for technical terms ([#548](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/548)) ([8defebc](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8defebc80bb598bacaa52d444482ef6848299ec4))
* implement issues [#567](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/567), [#568](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/568), [#569](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/569), [#570](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/570) ([e409e74](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/e409e748b900617dfe906939ddfc8d4941245dc1))
* implement issues [#567](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/567), [#568](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/568), [#569](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/569), [#570](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/570) ([e752371](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/e752371e38cdb01ab9abae4421e71ed5cf16f178))
* implement onboarding tour for first-time users ([#544](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/544)) ([0ef03da](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/0ef03da9c2cf2eaa1d1da996b1a9a3602eae1bf0))
* implement Soroban RPC connection pool with failover ([15088ee](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/15088eed82d985addce6df6a4e8aae84723e5d0c)), closes [#751](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/751)
* implement sponsor management dashboard for all created streams ([3fe8c93](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/3fe8c937930916801a851ff01227c033eac58847)), closes [#760](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/760)
* implement stream status state machine in database layer ([788e076](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/788e076267b0b74ede5854d2f2cc4391acad4e76)), closes [#753](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/753)
* implement transfer_recipient for stream reassignment ([250eca7](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/250eca74e0f5ddbd3ae7b4d73f6f43eb90bf4117)), closes [#588](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/588)
* implement wallet connection flow with multi-wallet support ([4041ba7](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/4041ba7e6915d608c8ce6c0954285a381da2ea74)), closes [#758](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/758)
* **indexer:** implement Horizon event indexer background service ([ab07034](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ab07034591b1b613cfcc31775d06284abfc7fc3b))
* **indexer:** migrate event polling to cursor-based pagination ([46ca827](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/46ca8276983a6b59b59fb23b464889b3973de985))
* **indexer:** migrate event polling to cursor-based pagination ([d0e0ba1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/d0e0ba16d7091e5062a8beed5d64f2ceac161a9f)), closes [#554](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/554)
* interactive deposit cost calculator with i128 overflow validation ([b874f35](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/b874f35b48bdbd1f9b808f5b8e1a85fe1556fbc5))
* interactive deposit cost calculator with i128 overflow validation ([#276](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/276)) ([7d1bbd1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/7d1bbd1b71a93f649f594e9ad8eec7f81f4808b8))
* JWT RS256 auth middleware with RBAC for admin endpoints ([c451cbf](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/c451cbfc8cb57d83d7e29cac0ee57d6a7618bee5)), closes [#742](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/742)
* **k8s:** complete production kubernetes manifests ([#391](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/391)) ([c2ec153](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/c2ec153e0982694c5d9087194da0ff26387fddb5))
* **load:** add 4 sustained traffic scenarios for backend API ([#629](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/629)) ([9c5296b](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/9c5296bc08d63aa33254293b2087d0b494980a80))
* **load:** add 4 sustained traffic scenarios for backend API ([#629](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/629)) ([e366feb](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/e366feb31cdf57b147bfe3371042e237c3372a22))
* **logging:** add structured correlation logging ([567f5b9](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/567f5b91a09f645bf7185d6ce3bad2c58c373a87))
* **logging:** add structured correlation logging ([2c64af2](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/2c64af25cef484db5d930813fe0f831479b03ea1))
* **logging:** replace console.log with pino structured JSON logger ([4668693](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/466869325839383a41e696256e62b0eb64a1d9e2))
* **metrics:** Prometheus metrics, Grafana dashboard, and alert rules ([8cb6475](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8cb64755769ee4167c8a168c5b20b89fd203d3cb)), closes [#756](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/756)
* **migration:** add schema_version field and migration framework ([#736](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/736)) ([d315e8a](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/d315e8ad3c638de7369da5e20feca7ee2d077af4))
* mobile bottom navigation bar ([#279](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/279)) ([aaf0651](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/aaf06515214c191a8dbb348e01e57f0fd07c7852))
* mobile bottom navigation bar ([#279](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/279)) ([7389fe2](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/7389fe2ecf5d2b2ecb24ea2924b745af959e7a43))
* multi-step create-stream form with live deposit preview ([#267](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/267)) ([cf46b9f](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/cf46b9f1a233cecd8838de24dd3c757eca7a0ecb))
* multi-step create-stream form with live deposit preview ([#267](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/267)) ([8c0a5f3](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8c0a5f34cc9885aa70cac502c77f2dcc0c5be94c))
* **notifications:** WebSocket push delivery, browser push API, preferences page ([#764](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/764)) ([4690c3b](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/4690c3bf2322f4613b6948c95e40951368b32160))
* offline caching, sponsor dashboard, and session timeout ([d77c75a](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/d77c75a019323aa6310501620e51b82efe0dd5d3))
* offline caching, sponsor dashboard, session timeout (closes [#281](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/281), [#283](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/283), [#284](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/284)) ([f4c6676](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/f4c66766e1070912e11c68472a3615c0f3a524aa))
* optional stream label (metadata) for off-chain indexing ([ba2b4ea](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ba2b4ea557edf7b631425bb83c9f20c6ef77d748))
* optional stream label for off-chain indexing ([#15](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/15)) ([886ac27](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/886ac2751800b2b886da507b62d9446aefb0148e))
* PDF print/export with PrintButton and VestingSchedulePrint ([a2115fc](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/a2115fc27481a9c309d367d07efcb060025f787d))
* PDF print/export with PrintButton and VestingSchedulePrint components ([#274](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/274)) ([4f81f8f](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/4f81f8f533273d5ceff388b4fbd1de7c819e8358))
* **rate-limit:** add write-endpoint stricter limits for issue [#551](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/551) ([3fa2ba6](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/3fa2ba6c7035893f51dfb287f6c59c97483f74a7))
* **rate-limit:** add write-endpoint stricter limits for issue [#551](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/551) ([7c391ad](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/7c391adee779085200285b759c2e77b7274d2f38))
* React Error Boundaries with per-card boundary and Sentry hook ([5bd4256](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/5bd4256b9a6b0d38419779c187943b614966cac7))
* reentrancy guard with LOCK flag for defence-in-depth ([ac69c7e](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ac69c7e3d0be10a27be6fc2a9aa6a135cc80d632))
* reentrancy guard with LOCK flag for defence-in-depth ([#13](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/13)) ([e4ea80d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/e4ea80d4d17109fa3dba859f441872a3c714fc04))
* restrict CORS to allowlisted origins ([c924485](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/c924485ad32462682248af2623f6ae661f931305))
* set up Docusaurus documentation site ([263ffd2](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/263ffd2b51e6d5846c4d975a090b108aaefa8176)), closes [#815](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/815)
* **sharing:** add public read-only stream view with OG meta tags ([#765](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/765)) ([6323bef](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6323bef897574120ddeae515c13dae9e319a7f79))
* **sharing:** add public read-only stream view with OG meta tags ([#765](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/765)) ([6323bef](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6323bef897574120ddeae515c13dae9e319a7f79))
* **sharing:** add public read-only stream view with OG meta tags ([#765](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/765)) ([a61f72a](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/a61f72aa8f0869def439a78a8afd813552198114))
* **storage:** proactive TTL refresh for long-duration streams ([#585](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/585)) ([280118e](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/280118ef47c206afd63960eae4982d84262f911b))
* **storage:** proactive TTL refresh for long-duration streams ([#585](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/585)) ([2f40e66](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/2f40e667c756a7d14958622a2beb72c4bcc6e4ab))
* StreamCreated full payload, token allowlist, schedule versionin… ([ed49c49](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ed49c49ae4531f779b7d21b600f740105a183114))
* StreamCreated full payload, token allowlist, schedule versionin… ([0b30a15](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/0b30a1589535f09ba0ad18798f56856b73cd137b))
* structured logging with full correlation ID propagation ([2580cee](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/2580ceebe9fafae53831971b17e37a763a04b881))
* support multiple streams per recipient ([#14](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/14)) ([c7e151a](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/c7e151a90de9ba0e844f3cf2d8cd3b8a3debd109))
* **testing:** add chaos testing framework for indexer resilience ([#787](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/787)) ([efd8d1f](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/efd8d1f444cd6be2fd9b6a5c812f0fb847df9f00))
* **testing:** add k6 TGE load test suite for API performance benchmarking ([#781](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/781)) ([60fa940](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/60fa94010b94ce6dc385128051b716e779fba924))
* **tests:** add contract invariant checker ([#790](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/790)) ([e347db6](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/e347db62818055f2c289ce86258825b7fb3540a9))
* **tests:** add contract upgrade & migration tests ([#782](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/782)) ([6f7f989](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6f7f989f7114574cda5abbdb8a2a49ed1f0390c9))
* **tests:** add test data factory with named stream scenarios ([8cce17b](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8cce17b6ab9318c665dd03da74dc2dd5d3feae56)), closes [#789](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/789)
* **tests:** add WebSocket E2E tests for real-time notification delivery ([#788](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/788)) ([ac6af5d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ac6af5d8896fe97431f57673bb49132a84e40307))
* unified wallet connection modal (Freighter / WalletConnect / Albedo) ([9d6ee32](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/9d6ee32649ad8be66161eb541550fdce28a76247))
* update vesting contract behavior and tests ([bab63c1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/bab63c1d2fa23c0674d7e8bd52f2a0ccf2247c89))
* update vesting contract behavior and tests ([eef8135](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/eef8135ac4472ea666f58d5df7b9be81c398e8cc))
* vesting dashboard with real-time progress bars and auto-refresh ([ca14415](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/ca14415f1e39d1e75a196ecfe36ece39f0372c25))
* **wallet:** persist connection state across page reloads ([9f95537](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/9f955372990589ed6c8f37fad24e739c1cadb782))
* **wallet:** persist connection state across page reloads ([e06f2fe](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/e06f2fe4e6f4cdd638250c9350cb8dc1b13f4f87)), closes [#531](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/531)
* **webhook:** add webhook registration, delivery, and retry system ([249df29](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/249df2960c4ae5b165150fa471e901255129e5dc))
* **webhooks:** add retry logic, DLQ, and HMAC validation for issue [#552](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/552) ([bbc05fb](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/bbc05fb13c62ab10b5ae00690f5e9e20b0937407))
* **webhooks:** add retry logic, DLQ, and HMAC validation for issue [#552](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/552) ([a4915e1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/a4915e19708c96d6eef15a976ef223d3a251d025))
* **ws:** implement real-time event push for vesting stream events ([64eb7e1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/64eb7e1c351ac7bd9f6904c986d204d69d6c5529))
* **ws:** implement real-time event push for vesting stream events ([6f4a1b8](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/6f4a1b8430beec5927b91ae3119ab3585be360ea))


### Bug Fixes

* **#729:** add InvalidRecipient regression test and document same-address guard ([0429550](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/0429550cc2de4f4e35f811e338bdd5f89952c6ac)), closes [#729](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/729)
* **#824:** audit and fix WCAG 2.1 AA violations on the served page ([67033b0](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/67033b0690b631395c8072489129e70dbdb466fa))
* **#840:** match lowercase log levels in the metric filters ([e07a013](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/e07a0137d4bfc22d47a05cc2579b71a8851163e5)), closes [#840](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/840)
* add cross-browser compatibility fixes for Safari and Firefox ([#547](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/547)) ([f6a6bb8](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/f6a6bb814be462985fbf1466d439a39b7ed1aca8))
* clarify error codes 17/22 and add tests for each distinct trigger path ([eca9501](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/eca95012006df8d4dcced61e2a2aa398b5a1a571)), closes [#735](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/735)
* **contract:** reject zero cliff_duration with InvalidCliffDuration ([41dbb6d](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/41dbb6d3e0bf6872f2eac209daad4ca806135876))
* **contract:** restore compilability — dedup entry points, add missing variants and emitters ([169a84e](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/169a84e35ff47137c903ee5c3a502f7234a6fa5b)), closes [#856](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/856)
* **frontend:** add cross-browser compatibility fixes for Safari and Firefox ([9dca040](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/9dca04007b8acbfd64a9fac9f83ff7b3aeea54ac))
* **migration:** implement schema dry-run reporting ([f87f1a5](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/f87f1a5c81cded9cb2d0163a65e29c18fb63d0b4))
* reject zero cliff duration ([#730](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/730)) ([2c522d3](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/2c522d3feec34e78b9dea75d9d8e44fe5ac36f22))
* resolve 6 terraform validate errors ([#865](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/865)) ([fe83630](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/fe83630b5ea82a06ca84b02ef7262aa81558d5da))
* resolve four Kiro review issues ([9f127e3](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/9f127e378885cf75da6e6ebcf2e1231ec411f534))
* resolve merge conflicts in deploy.sh and smoke_test.sh ([1244d9e](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/1244d9eb0d55350b7703ea0403bf2f90cd9d11e6))
* **smoke:** replace non-existent get_min_deposit with claimable_amount ([#793](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/793)) ([84504ee](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/84504ee892ff040e2e81e80017f8ecee73997140))


### Performance Improvements

* add benchmarks for new entry points and CI regression threshold check ([d7b0499](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/d7b04994c2eb7e93bf423139e206f5afafd15b61))
* add benchmarks for new entry points with CI regression thresholds ([a4543b6](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/a4543b6033335eca5d2dace9e673572c9776c823))
* **db:** connection pooling, indexes, query optimisations, and Prometheus metrics ([5ada906](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/5ada906fe529809d97f2f7547861f286aa0a8431)), closes [#741](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/741)

## [Unreleased]

### Added

- Optional stream label (`metadata: Option<String>`) on `VestingSchedule`. Sponsors can attach a human-readable label (e.g. `"Q1 Grant"`) at creation time for off-chain indexing and display. Empty strings are normalised to `None`; values longer than 256 UTF-8 bytes are rejected with `MetadataTooLong` (error code 20). The label is immutable after stream creation. ([#15](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/15))
- `StreamCreated` events now carry the full schedule payload (`token`, `rate`, `start_ledger`, `cliff_ledger`, `end_ledger`, `total_deposit`) so off-chain indexers can reconstruct stream state from events alone. ([#321](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/321))
- Admin-controlled token allowlisting for `create_vesting_stream` with `add_allowed_token`, `remove_allowed_token`, and `get_allowed_tokens` entry-points. Creating a stream with a non-allowlisted token returns `RecipientNotAllowed` (error code 14). ([#320](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/320))
- Schedule versioning: a monotonically increasing `version` counter is stored in `VestingSchedule` and surfaced via `get_schedule`. Incremented on every mutating operation (claim, cancel, transfer). ([#318](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/318), [#319](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/319))
- Fuzz harness for `metadata` length validation added to `fuzz/fuzz_targets/metadata_validation.rs`.
- Integration test suite for `schedule_version` increments under claim, cancel, and transfer operations (`tests/integration/schedule_version.test.js`).

### Changed

- The `StreamCreated` event topics remain minimal at three values: `"StreamCreated"`, `sponsor`, and `recipient` for efficient filtering.

---

## [1.2.0] - 2026-08-31

### Added

#### Contract

- `pause_stream` and `resume_stream` entry-points: admin or sponsor can pause an active stream; claims on a paused stream return `StreamPaused` (error code 15); `resume_stream` restores normal dripping. ([#571](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/571))
- `transfer_recipient`: sponsor can atomically reassign a stream to a new recipient address; emits `RecipientTransferred` event. ([#588](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/588))
- `create_variable_stream` / `claim_variable_vested`: variable-rate streams defined by a `Vec<RateSegment>` (each with `start_ledger` + `rate`). Invalid segments (empty, out-of-order, non-positive rate) return `InvalidSegments` (error code 19). ([#574](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/574), [#572](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/572))
- `batch_create` / `batch_claim`: process up to 20 streams in a single transaction; exceeding the cap returns `BatchTooLarge` (error code 16). ([#572](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/572))
- `set_fee` / fee collection mechanism: optional basis-point fee deducted at claim time and forwarded to a treasury address. Fee capped at 500 bps (5%); higher values return `InvalidRate` (error code 4). ([#575](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/575))
- `InvalidToken` (error code 12): `create_vesting_stream` now validates that the token address is a live SAC by calling `try_balance` before persisting the schedule. ([#9](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/9))
- `stream_status()` on-chain view function returning the full lifecycle state enum (`Active`, `Paused`, `Expired`, `Cancelled`, `Drained`). ([#583](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/583))
- `get_total_claimed`, `get_stats`, `get_streams_for_sponsor`, `get_status` view functions. ([#579](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/579), [#580](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/580), [#581](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/581))
- `set_config` / `get_config`: admin-settable `ConfigMaxCliffRatio` and `ConfigMinRate` guards enforced on stream creation. ([#11](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/11))
- `emergency_drain`: admin-gated immediate recovery of tokens from any vault (bypass drain delay). ([#579](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/579))
- Reentrancy guard using a `LOCK` flag in instance storage for defence-in-depth. ([#13](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/13))
- Proactive TTL refresh for long-duration streams, preventing storage expiry mid-stream. ([#585](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/585))
- Fixed-point rate representation and cliff-ratio guard added to `create_vesting_stream`. ([#567](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/567))
- `clawback_stream` hardened with SAC flag check — returns `ClawbackNotSupported` (error code 26) for tokens without the SAC clawback flag. Sponsor identity re-validated. ([#584](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/584))
- `StreamAlreadyPaused` (error code 23) and `StreamNotPaused` (error code 24) error codes.
- `VersionOverflow` (error code 25) returned when the version counter reaches `u32::MAX`.

#### Backend API (v1.1.0 — 2026-08-28)

- **GET `/health`** — Liveness probe returning `{ status, version, uptime }`.
- **GET `/health/horizon`** — Horizon connectivity check returning `{ status, endpoints }`.
- **GET `/health/horizon/circuit-breaker`** — Circuit-breaker state (`closed` / `open` / `half-open`).
- **GET `/api/openapi.json`** — Raw OpenAPI 3.0 spec.
- **GET `/api/v1/schedules`** — Paginated schedule list (JWT-authenticated; `sub` claim must match `sponsor` param).
- **GET `/api/v1/schedules/export`** — CSV/JSON export with `from`/`to` date filtering.
- **GET `/api/v1/schedules/sponsor/{sponsor}`** — Legacy Horizon-based sponsor lookup.
- **GET `/admin/indexer/status`** — Indexer health (Basic Auth, internal only).
- **GET `/admin/metrics`** — Prometheus text metrics (Basic Auth, internal only).
- **POST `/api/v1/admin/drain`** — Drain expired streams with optional dry-run.
- **GET `/api/v1/metrics`** — JSON operational metrics (cache hit rates).
- **WebSocket `/ws/claimable`** — Real-time claimable balance subscription. ([#698](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/698))
- **GET `/streams/:recipient/versions`** — Retrieve full version history for a schedule. ([#286](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/286))
- **POST `/api/v1/backfill`** — Replay Horizon events into `stream_events` after indexer downtime. ([#286](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/286))
- Soroban RPC view-call caching with per-function TTLs (Redis). ([#699](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/699))
- Zod request validation on all API endpoints. ([#700](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/700))
- Admin API protected by Bearer token auth. ([#701](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/701))
- PostgreSQL connection pool with Prometheus metrics and health endpoint. ([#689](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/689))
- Complete OpenTelemetry tracing with distributed correlation IDs. ([#697](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/697))
- Horizon circuit breaker with `/health` state exposure. ([#703](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/703))
- Webhook retry logic, dead-letter queue (DLQ), and HMAC validation. ([#552](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/552))
- Stricter rate limits on write endpoints. ([#551](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/551))
- GraphQL depth-limit enforcement. ([#553](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/553))
- Cursor-based pagination for the schedules list endpoint. ([#554](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/554))
- Structured logging with full correlation ID propagation throughout the backend. ([#705](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/705))
- `schedule-version-recorder.js`: persists schedule version history to `schedule_versions` table. ([#005](https://github.com/AlienScroll78/vesting-cliff-drip-stream/blob/main/backend/migrations/005_create_schedule_versions.ts))
- Event indexer pipeline with backfill script and integration tests. ([#286](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/286))
- `stream_events` table and migration `004_create_stream_events.ts`.

#### Frontend

- Vesting dashboard with real-time progress bars, sort/filter/table view, and 30-second auto-refresh. ([#277](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/277), [#661](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/661))
- Multi-step create-stream wizard (4 steps with live deposit preview). ([#267](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/267))
- Unified wallet connection modal (Freighter / WalletConnect / Albedo). ([#659](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/659))
- Offline caching via service worker with offline splash page. ([#539](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/539))
- Full dark mode support with OS preference detection and 200 ms transitions. ([#273](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/273))
- PDF print/export with `PrintButton` and `VestingSchedulePrint` components. ([#274](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/274), [#541](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/541))
- Mobile claim bottom sheet with swipe-to-dismiss. ([#542](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/542))
- `StreamStatusBadge` component with all 6 lifecycle states and accessible colour tokens. ([#543](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/543))
- Component styles migrated to CSS Modules. ([#540](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/540))
- Horizon API status banner, mobile bottom navigation bar, and i18n framework (EN/ES). ([#278](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/278), [#279](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/279), [#280](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/280))
- Interactive deposit cost calculator with `i128` overflow validation. ([#276](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/276))
- Glossary tooltip system with `@floating-ui/react`. ([#380](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/380))
- Skeleton loading screens with shimmer animation. ([#549](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/549))
- Error boundaries with per-card Sentry integration. ([#275](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/275), [#545](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/545))
- Onboarding tour for first-time sponsor users. ([#544](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/544))
- Transaction history panel backed by Horizon event stream.
- CANCEL-typed confirmation gate for cancel-stream action. ([#550](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/550))
- Wallet connection state persisted across page reloads.
- Full event tracking / analytics integration. ([#546](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/546))
- SVG vesting timeline component and stream comparison view. ([#381](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/381))

#### Infrastructure & Operations

- Automated Terraform drift detection scheduled daily at 02:00 UTC; opens a GitHub issue and sends Slack alert on detected drift. ([#411](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/411))
- Cost anomaly alerting with ECS/RDS CloudWatch monitors and Slack relay Lambda. ([#566](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/566))
- Migration rollback support with CLI scripts and integration tests. ([#561](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/561))
- Kubernetes NetworkPolicy resources for least-privilege pod networking. ([#410](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/410))
- Production-ready Kubernetes manifests for backend-api, event-worker, and frontend deployments.
- Production Helm chart (`helm/vesting-backend`) with staging/production value overrides. ([#264](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/264))
- External Secrets Operator configuration for AWS Secrets Manager and HashiCorp Vault. ([#8ececef](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/8ececef))

### Changed

- Backend API version bumped from `1.0.0` to `1.1.0`; all new endpoints are additive (no breaking changes to existing `GET /api/v1/schedules/{recipient}`).
- `StreamCreated` event payload extended with full schedule fields (non-breaking; existing topic structure unchanged).
- `clawback_stream` now validates SAC clawback flag before proceeding; previously would fail at the token-transfer step.

### Fixed

- WASM build failure under `#![deny(missing_docs)]` — added `#[allow(missing_docs)]` on the `contracterror` macro output. ([#336be60](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/336be60))
- Merge conflict in `Makefile` between `main` and `perf-regression-ci` branches resolved. ([#413](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/413))
- Production readiness CI checks repaired after pipeline regression. ([#7b0f41c](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/7b0f41c))
- Cross-browser compatibility issues with Playwright E2E tests on WebKit. ([#547](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/547))

### Security

- SBOM (SPDX 2.3 JSON) generated for every release and license scanning on every PR. ([#414](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/414))
- Container image signed with `cosign` and SLSA provenance attached to each release. ([#416](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/416))
- CodeQL SAST analysis added to pipeline. ([#216](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/216))
- Automated dependency vulnerability scanning pipeline (`cargo audit`, `npm audit`). ([#419](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/419))

---

## [1.1.0] - 2026-07-29

### Added

#### Contract

- `drain_expired_stream`: permissionless cleanup of fully expired streams. Any caller can invoke after `end_ledger + 6,307,200` ledgers (~1 year); transfers remaining tokens to the original sponsor. Returns `DrainDelayNotExpired` (error code 10) if called early. Emits `StreamDrained` event. ([#316](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/316))
- `clawback_stream`: compliance clawback recovering all remaining vault tokens to the original sponsor, bypassing cliff state. Only available on tokens with `AUTH_CLAWBACK_ENABLED_FLAG`. Accepts a `reason` string (max 256 chars). Emits `StreamClawedBack` event. ([#317](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/317))
- `set_min_deposit` / `get_min_deposit`: admin-controlled minimum total deposit threshold (default 100 tokens). Stream creation is rejected with `RateTooLow` (error code 17) when `rate × total_duration` falls below the threshold. ([#314](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/314))
- `initialize` admin entry-point: one-time contract initialisation storing the admin address; subsequent calls return `AlreadyInitialized` (error code 13). ([#321](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/321))
- `upgrade` admin entry-point: admin-gated Wasm hash replacement for live contract upgrades. ([#931bdc7](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/931bdc7))
- `transfer_admin`: atomic admin key rotation to a new address.
- `StreamCreated` event now includes `token`, `rate`, `start_ledger`, `cliff_ledger`, `end_ledger`, and `total_deposit` in the data payload for richer indexer reconstruction. ([#318](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/318))
- `InvalidCliffDuration` (error code 12 → renumbered to 12 in this version): rejects streams where `cliff_duration` is zero.
- `InvalidRecipient` (error code 11): rejects streams where sponsor and recipient are the same address.
- `NotInitialized` (error code 18): returned by all mutating functions before `initialize` is called.
- `ClawbackNotSupported` (error code 26) stub (enforced in v1.2.0).
- Mutation testing setup with `cargo-mutants`; baseline mutation score ≥ 80%. ([#315](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/315))

#### Backend

- Initial backend API server (`backend/`) with Node.js/TypeScript, Express, and PostgreSQL.
- **GET `/api/v1/schedules/{recipient}`** — Full vesting schedule with computed fields (initial v1.0.0 endpoint; now served by new backend).
- Database migrations V1–V4: `schedules`, `events`, `claims`, and cursor-pagination index. ([#285](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/285))
- Soroban view proxy (`sorobanViews.js`) with configurable RPC endpoint.
- Event indexer (`indexer.ts`) polling Horizon for `StreamCreated`, `VestingClaimed`, and `StreamCancelled` events.
- `contract-version.js` helper surfacing on-chain contract version for health checks.

#### Infrastructure

- Production Helm chart `helm/vesting-backend` with GitHub Pages chart publishing. ([#260](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/260))
- k6 load tests for concurrent stream creation and backend API scenarios. ([#165](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/165))
- Playwright E2E lifecycle test suite (create → cliff → claim → cancel). ([#451](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/451))
- Horizon network resilience tests using Toxiproxy. ([#357](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/357))
- Performance regression gate: blocks merge if `claimable_amount` CPU instruction count regresses by >5%. ([#415](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/415))
- Storybook stories with interaction tests and `@storybook/addon-a11y`. ([#387](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/387))
- Usability testing protocol and research documentation. ([#388](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/388))
- cargo-fuzz targets for `create_vesting_stream` and `claim_vested`. ([#3d360ab](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/3d360ab))
- Playwright visual regression snapshots for all major UI components. ([#445](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/445))
- Comprehensive smoke tests for testnet deployment (`scripts/smoke_test.sh`). ([#516](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/516))
- Container registry pipeline with cosign image signing. ([#416](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/416))
- Automated staging CI/CD pipeline with smoke tests and rollback. ([#417](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/417))
- Branch protection rules, CODEOWNERS file, and CI job naming conventions. ([#418](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/418))

### Performance

- `claimable_amount` and `is_cliff_passed` views skip TTL bump on read-only access, reducing per-call ledger write overhead. ([#16](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/16))

### Fixed

- `end_ledger` boundary: tokens accrued exactly at `end_ledger` are now claimable (off-by-one corrected). ([#dd158f1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/commit/dd158f1))
- WASM build repaired under CI `wasm32-unknown-unknown` target after dependency update. ([#170](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/170))

---

## [1.0.0] - 2026-06-26

### Added

#### Contract

- `create_vesting_stream` entry-point: sponsor deposits full token allocation upfront into the contract vault. Parameters: `sponsor`, `recipient`, `token` (SAC address), `rate` (tokens per ledger), `cliff_duration` (ledgers until cliff), `total_duration` (total stream length, must be > `cliff_duration`). ([#1](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/1))
- `claim_vested` entry-point: recipient claims all accrued tokens in a single call. Returns the amount transferred. Returns `CliffNotReached` (error code 2) before `cliff_ledger`; provides instant catch-up for all tokens accrued since `start_ledger` at the cliff. ([#2](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/2))
- `cancel_stream` entry-point: sponsor cancels an active stream. If the cliff has passed, the recipient receives all accrued tokens and the sponsor recovers the remainder. If the cliff has not passed, the full deposit is refunded to the sponsor. ([#3](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/3))
- `VestingSchedule` storage type with fields: `start_ledger`, `cliff_ledger`, `end_ledger`, `rate`, `sponsor`, `token`, `claimed`.
- `VestingError` enum with seven typed error codes:
  - `1` — `ScheduleNotFound`
  - `2` — `CliffNotReached`
  - `3` — `InvalidDuration`
  - `4` — `InvalidRate`
  - `5` — `DepositOverflow`
  - `6` — `ScheduleAlreadyExists`
  - `7` — `NothingToClaim`
- View functions: `get_schedule(recipient)`, `claimable_amount(recipient)`, `is_cliff_passed(recipient)`.
- Structured on-chain events: `StreamCreated`, `VestingClaimed`, `StreamCancelled`.
- Persistent storage helpers with automatic TTL bumping (~60-day window) to prevent expiry of active streams.
- Overflow-safe arithmetic throughout using `checked_mul` / `checked_add`; returns `DepositOverflow` instead of panicking.
- Duplicate-stream prevention: `ScheduleAlreadyExists` returned for a second stream to the same recipient.
- Full test suite: creation, claiming, cancellation, view functions, edge/boundary cases, property-based tests, event snapshots, and auth edge cases.
- `Makefile` targets: `build`, `test`, `lint`, `fmt`, `mutants`.
- `scripts/deploy.sh`: build-optimise-deploy to Stellar testnet.
- `scripts/invoke_create.sh` and `scripts/invoke_claim.sh`: CLI helpers for manual testing.

#### Frontend (initial release)

- Wallet connect button with Freighter/WalletConnect/Albedo support and three states (disconnected, connecting, connected). ([#130](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/130))
- Stream-status badges with colour-coded lifecycle states. ([#128](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/128))
- Mobile claim bottom sheet (initial design). ([#129](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/129))
- Date/time picker for cliff and total duration. ([#131](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/131))
- Segmented progress bar with locked/cliff/drip sections and tooltips.
- Transaction status drawer (pending / confirmed / failed).
- Sponsor stream creation success screen with confetti and share link. ([#132](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/132))
- SVG logo, favicon set (16/32/180 px), and web manifest. ([#128](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/128))
- Print stylesheet for vesting schedule summary. ([#129](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/129))
- i18n date/time utility with `Intl.DateTimeFormat` and relative clock. ([#134](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/134))
- Keyboard shortcut reference modal. ([#133](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/133))
- Design system component library with CSS custom properties and design tokens.
- Improved number formatting for large token amounts. ([#127](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/127))
- i18n framework, analytics event tracking, admin panel, and keyboard navigation. ([#66](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/66), [#67](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/67), [#68](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/68), [#69](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/69))
- Transaction history panel and cancel confirmation modal. ([#57](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/57), [#56](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/56))
- Error boundary components for resilient UI. ([#275](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/275))
- Playwright E2E test suite on local Stellar quickstart. ([#97](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/97))

#### Infrastructure & CI

- GitHub Actions CI pipeline: lint (`cargo fmt` + `clippy`), `contract-test`, WASM `build`, and TypeScript `typecheck` jobs. ([#135](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/135))
- Automated WASM optimization and size-check CI (95 KB budget). ([#136](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/136))
- Docker build/push/scan workflow with multi-stage Dockerfile. ([#137](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/137))
- Staging deployment pipeline. ([#139](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/139))
- Terraform IaC modules for ECS, RDS, VPC, and Redis on AWS. ([#140](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/140))
- AWS Secrets Manager integration with ECS task-definition snippet. ([#141](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/141))
- CloudWatch log aggregation with runbook. ([#142](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/142))
- `cargo audit` dependency vulnerability scanning. ([#138](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/138))
- Automated release workflow with semantic versioning and WASM artifact attachment. ([#144](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/144))
- Uptime monitoring and alerting setup. ([#143](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/143))
- RDS automated backup workflow and restore runbook. ([#146](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/146))
- Branch protection script and CONTRIBUTING.md. ([#145](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/145))
- Accessibility audit report and `axe-core` integration. ([#126](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/126))
- Sponsor cost calculator documentation. ([#184](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/184))
- Mermaid sequence diagrams for contract flows (`docs/flows.md`).
- Error handling guide for integrators (`docs/error-handling.md`). ([#87](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/87))
- Wallet integration guide with JS SDK examples. ([#183](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/183))
- Comparison guide versus standard Drips protocol. ([#94](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/94))
- Architecture Decision Records (ADRs 0001–0006).
- SECURITY.md vulnerability disclosure policy.
- CODE_OF_CONDUCT.md (Contributor Covenant 2.1).
- Property-based tests for `claimable_amount` with `proptest`. ([#96](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/96))
- Snapshot tests for all contract events. ([#102](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/102))
- Contract upgrade / migration test. ([#105](https://github.com/AlienScroll78/vesting-cliff-drip-stream/issues/105))
- `DepositOverflow` boundary test (`i128::MAX / total_duration + 1`). ([#168](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/168))
- Mutation testing with `cargo-mutants` and targeted survivor tests. ([#169](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/169))
- Visual regression snapshot baseline. ([#167](https://github.com/AlienScroll78/vesting-cliff-drip-stream/pull/167))

---

<!-- Link definitions -->
[Unreleased]: https://github.com/AlienScroll78/vesting-cliff-drip-stream/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/AlienScroll78/vesting-cliff-drip-stream/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/AlienScroll78/vesting-cliff-drip-stream/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/AlienScroll78/vesting-cliff-drip-stream/releases/tag/v1.0.0
