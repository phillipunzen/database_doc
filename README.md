# DatAtlas

DatAtlas is a web application for documenting databases and data warehouses. It stores users, sessions, encrypted connections, schema snapshots, documentation notes, source ownership and tags, scan schedules, search indexes, and audit events in a separate MariaDB database.

Supported database adapters: **Microsoft SQL Server, MySQL, MariaDB, PostgreSQL, MongoDB, and SQLite**.

The application interface is currently in German. This README and the configuration documentation are in English.

## Quick start

Requirements: Docker Engine and Docker Compose, with network access to the databases you want to document.

```bash
git clone https://github.com/phillipunzen/database_doc.git
cd database_doc
python3 scripts/init-env.py
```

The initialization script creates `.env` with individual passwords and encryption/session secrets. It does not print secrets or overwrite an existing file. Alternatively, copy `.env.example` to `.env` and configure these values yourself.

Before starting, edit `.env`:

- Set `APP_URL` to the exact base URL you will use in your browser, such as `http://localhost:8090` for local development.
- Set `APP_PORT` and `APP_BIND` if you need a different port or bind address.
- Keep `.env` private. It contains application and database credentials.

```bash
mkdir -p sources
docker compose up -d --build
docker compose ps
```

Open the URL configured in `APP_URL`. The default application port is `8090`; MariaDB does not expose a host port.

The existing development deployment is available at **http://192.168.10.70:8090**, with its checkout at `/opt/datenbankdokumentation`.

## First sign-in

The initial username is `admin`, unless you set `ADMIN_USERNAME`. The generated initial password is stored in `.env` as `ADMIN_PASSWORD`; the initialization script creates this file with mode `0600`.

After signing in, use the password-change action in the sidebar to replace the initial password. The bootstrap variables create the administrator only when the application database contains no users. Changing `ADMIN_PASSWORD` in `.env` does not reset an existing account.

### Example database

The existing development deployment includes a source named **Beispiel · Bestellverwaltung** containing only fictional data. Open it to explore the table documentation or ER diagram. Its SQLite file is mounted read-only from `sources/beispiel.sqlite`.

The generated SQLite file is excluded from Git. To create it in a fresh checkout:

```bash
python3 scripts/create-demo.py
```

Then add a SQLite source in the application with the container path `/sources/beispiel.sqlite` and start a schema scan. The script does not overwrite an existing example file.

## Features

The source dashboard defaults to a compact list with locally served database-engine logos. Search by name, server, database, schema, tag, or owner; combine engine, server, tag, and scan-status filters; sort by name, engine, server, object count, status, or last scan. Pagination supports 25, 50, or 100 sources per page. An optional card view uses the same filters and pagination. Filters and page selection are retained while navigating between a source and the catalog. The mobile list uses compact stacked rows.

- Multiple data sources with individual connection settings and encrypted credentials.
- Database discovery on a server. Each source documents one database; an optional schema setting narrows the scan.
- Manual and scheduled background scans of tables, views, columns, data types, nullability, defaults, primary and foreign keys, indexes, unique constraints, and database comments where supported by the adapter.
- Interactive ER diagrams based on declared foreign keys, with draggable tables and background, zoom, and SVG export. Diagrams display up to 80 objects; the table browser includes all documented objects.
- Documentation notes for each object, retained across subsequent scans.
- Stored schema snapshots with comparisons of any two retained versions, plus JSON and Markdown exports.
- Source tags, a responsible person or team, and contact email, shown in the catalog and documentation exports.
- Global search across the latest documented tables, columns, database comments, and object notes, restricted to sources granted to the signed-in user.
- Separately authorized data previews of up to 50 rows. Preview values are not persisted. Individual values are limited to 2,000 characters; binary values are represented by their size. There is no arbitrary SQL console.
- User management, source-specific access grants, an activity log, local authentication, and configurable Entra ID and Active Directory authentication.

For MongoDB, scans collect collections, indexes, and validators by default. Optional field inference reads up to 100 documents per collection and stores only field names and observed types. It may miss rare or unobserved fields. Relationships are not inferred from field names, and data previews require a separate permission.

Scans are limited to 2,000 objects and run on two threads in a single application process. The queue accepts up to ten active or queued jobs. After a restart, interrupted jobs are marked as failed and can be started again.

PostgreSQL materialized views, stored procedures, and ETL or pipeline lineage are not yet supported.

## Automatic scans

Open a source and select **Automatische Scans**. An administrator or an editor with an editing grant can enable an hourly, daily, or weekly schedule. Existing sources have automatic scans disabled until a schedule is explicitly enabled.

- Hourly schedules first run one hour after saving and then one hour after each automatic start.
- Daily and weekly schedules follow the selected local time and IANA time zone; the default is `Europe/Berlin`. The next-run display includes that zone.
- Spring daylight-saving gaps move the scheduled time forward by the gap. During the repeated autumn hour, only the first occurrence is used.
- The scheduler checks persisted due times every 30 seconds. Jobs may start later when the two workers or ten-job queue are occupied. A source cannot have two active scans.
- After an application outage, one overdue run is queued and the next due time advances into the future; missed intervals do not create a backlog.
- Before each scheduled run, the account that last saved the schedule must still be active and have editing access. Otherwise the schedule is disabled with a visible explanation. Another authorized editor can save and enable it again.
- Each successful automatic scan retains a new snapshot; historical snapshots are not automatically pruned.
- Disabling a schedule prevents future automatic starts; a scan already queued or running finishes normally. Manual scans remain available and do not change the next automatic due time.

Schedules, automatic scan starts, and changes to ownership/tags are recorded in the activity log. The scheduler runs inside the existing single application process; do not add Uvicorn workers or application replicas.

## Schema comparison

Select **Schema-Vergleich** inside a source. With at least two successful snapshots, DatAtlas initially compares the two latest versions. Choose another older/newer pair to compare retained history.

The comparison identifies added and removed tables, views, or collections; added, removed, and changed columns; changes to column types, nullability, defaults, primary-key flags, and comments; and changes to object type, primary/foreign keys, indexes, unique constraints, and MongoDB validators. Constraint list order does not produce false changes. Summary counts include columns belonging to added or removed objects.

Comparisons use stored metadata and do not connect to the source database. Renames appear as removal and addition. Row values, documentation notes, ownership, and tags are excluded. MongoDB field inference is based on samples, so apparent differences can reflect the documents sampled rather than a structural migration.

## Tags and owners

Use **Tags & Verantwortliche** inside a source to set up to 20 tags, a responsible person or team, and a contact email. Tags are comma-separated in the interface, trimmed, and deduplicated without regard to case. Each tag may contain up to 60 characters.

Tags appear in catalog rows and have their own filter. Catalog text search also matches tags, owner names, and contact emails. JSON and Markdown documentation exports include ownership and tags. These fields describe responsibility; they do not grant access or send notifications.

## Global search

Select **Globale Suche** in the sidebar. Enter at least two characters to search table/collection names, schema names, column/field names and types, database comments, and documentation notes across accessible sources. Multiple words must all occur in a result. Filter by source or result type; results are paginated at 50 per page.

Opening a result navigates to its current object. Column results highlight the matching column; note results open the documentation tab. These object links survive browser reloads.

Only the latest successful snapshot of each source is indexed. Successful scans replace the index transactionally; failed scans preserve the previous snapshot and its index. Editing a note updates search immediately. Removing a source or changing its connection target removes the corresponding search entries. Source grants are checked at query time, so revoking access also removes those results immediately. Connection settings, credentials, and row previews are never indexed.

The index uses literal substring matching over stored metadata, including literal `%` and `_` characters. For very large schemas, narrow the source/type filters; result pagination limits responses but does not eliminate the cost of scanning matching text.

## Upgrading an existing installation

Back up the application database and encryption key, then rebuild and recreate the app with `docker compose up -d --build app`. Startup creates the additional metadata, schedule, search-index, and migration-version tables without altering existing source records. The initial migration indexes the latest existing snapshots and notes once; subsequent startups skip this backfill. Source connections, users, grants, snapshots, and notes are retained.

All existing sources begin without tags/owners and with automatic scanning disabled. The migration does not connect to or scan source databases. Initial startup can take longer when backfilling a large existing catalog.

### Feature API

All endpoints require authentication. Writes require a CSRF token and source editing access; reads require source access. Global search automatically limits its result set to permitted sources.

| Endpoint | Purpose |
| --- | --- |
| `PUT /api/sources/{id}/metadata` | Save `{tags: [...], owner: "...", owner_email: "..."}`. |
| `GET /api/sources/{id}/schedule` | Read the schedule, next due time, and last automatic start. |
| `PUT /api/sources/{id}/schedule` | Save `{enabled, cadence, hour, minute, weekday, timezone}`; weekday is Monday `0` through Sunday `6`. |
| `GET /api/sources/{id}/compare?before=...&after=...` | Compare two snapshots from the same source; `before` must be older. |
| `GET /api/search?q=...&source_id=...&kind=...&page=...&page_size=...` | Search current metadata; source is optional, kind is `all`, `table`, `column`, or `note`, page size is 1–100. |

Dates returned by these endpoints are UTC. Source listing responses also include tags, owner/contact fields, and schedule details.

## Permissions

| Role | Documentation | Editing and scanning | Data preview | Administration |
| --- | --- | --- | --- | --- |
| Administrator | All sources | All sources | All sources | Yes |
| Editor | Granted sources only | Requires an additional editing grant | Requires an additional data grant | No |
| Viewer | Granted sources only | No | Requires an additional data grant | No |

The user-management page lets administrators create local accounts, deactivate accounts, and grant access to specific databases. New external accounts are created as viewers without source access after successful authentication.

Roles are managed within DatAtlas in this version; AD and Entra groups are not mapped to application roles. External identities are matched using stable tenant/object IDs or the AD `objectGUID`. Accounts are not merged by email address.

## Docker operations

Run these commands from your checkout directory:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

The application container runs as an unprivileged user with a read-only root filesystem. It mounts `./sources` read-only at `/sources`. SQLite files must be readable by container user UID `10001`.

MariaDB data is stored in the Compose-managed `mariadb_data` volume. Its name includes the Compose project name; on the existing development server, it is `datenbankdokumentation_mariadb_data`.

### HTTPS and network settings

Direct HTTP is configured for the development environment. For production, use an HTTPS reverse proxy, set `APP_URL=https://...`, and set `COOKIE_SECURE=true`. When the reverse proxy runs on the same host, set `APP_BIND=127.0.0.1`.

The proxy must preserve the original Host and Origin information. Requests from other origins cannot make changes. The application and MariaDB communicate over the internal Docker network. Source databases must also be reachable from the application container; `localhost` inside that container refers to the application container itself.

The application is designed for one Uvicorn process. Do not start additional workers or parallel application replicas: scan coordination and login throttling are implemented per process. Scaling requires a separate job worker and a shared queue.

### Encryption and sessions

Connection configurations, including passwords, are encrypted with Fernet. Back up `ENCRYPTION_KEY` separately from the database dump: existing connections cannot be decrypted without it. Key rotation requires migrating stored connection configurations; do not simply replace the key.

Local passwords are hashed with Argon2. Session cookies are HttpOnly and SameSite=Lax, expire after eight hours, and are checked server-side. State-changing requests require a CSRF token.

Login attempts are limited to ten per client IP within five minutes in the application process. Users behind a proxy that does not forward client IPs share this limit. Role or account-status changes revoke the affected user's existing sessions.

## Connecting source databases

Use the add-source action to enter the database type, host, port, username, and password. The database-discovery action loads accessible database names into the database field's suggestion list. If server permissions do not allow discovery, enter the database name directly.

When no database is supplied, discovery initially connects to `postgres` for PostgreSQL or `master` for SQL Server. If that database is inaccessible, provide a known accessible database for discovery.

Test the connection, save the source, and start a schema scan. A connection test verifies connectivity and authentication, not complete metadata access.

Changing the target server, database, schema, SQLite path, or database type removes that source's previous snapshots and notes so they are not associated with a different target. Changes to the display name or password retain the documentation.

Use dedicated source accounts with only the required read permissions. The application does not issue DDL or data-modification commands against source databases. PostgreSQL, MySQL, and MariaDB connections are additionally configured as read-only; SQLite is opened with `mode=ro`. For SQL Server and MongoDB, the source account must enforce the write restriction.

| Database type | Default port | Notes |
| --- | --- | --- |
| Microsoft SQL Server | 1433 | ODBC Driver 18 is included in the image. Grant metadata visibility/`VIEW DEFINITION` and `SELECT` for required objects. Windows Integrated Authentication for source connections is not yet implemented. |
| MySQL / MariaDB | 3306 | Allow visibility of the selected database, tables, views, and metadata. Grant `SELECT` only where previews are needed. |
| PostgreSQL | 5432 | Grant `CONNECT` on the database, `USAGE` on schemas, metadata visibility, and `SELECT` for previews. |
| MongoDB | 27017 | Requires `listCollections`/`listIndexes`, plus `find` for inference or previews. Database discovery needs appropriate listing permissions. |
| SQLite | — | Place the file in the host's `sources/` directory and use a container path such as `/sources/database.sqlite`. Paths outside this directory are rejected. Provide a consistent export for databases using WAL mode. |

TLS with certificate validation is enabled by default for network sources. PostgreSQL, MySQL, MariaDB, and MongoDB use system CAs or an optional `SOURCE_CA_FILE`. Internal CAs must be available and trusted inside the container. For SQL Server, build an image variant that installs the internal CA in the operating system trust store. Self-signed certificates are not accepted without a trusted CA. TLS can be explicitly disabled for local test sources that do not support it.

## Microsoft Entra ID

OIDC authentication is implemented but has not yet been configured or integration-tested against a real tenant on this server.

1. Register a single-tenant application in Entra ID.
2. Set its Web redirect URI to the exact value of `APP_URL` followed by `/auth/entra/callback`, for example `https://datatlas.example.org/auth/entra/callback`.
3. Set `ENTRA_TENANT_ID` (tenant GUID), `ENTRA_CLIENT_ID`, and `ENTRA_CLIENT_SECRET` in `.env`.
4. Recreate the application container: `docker compose up -d --force-recreate app`.
5. Have users sign in through the Microsoft Entra ID option, then assign their roles and source grants as an administrator.

OIDC uses discovery, signed-token validation, state, and nonce. The callback accepts only the configured tenant. Local authentication remains available for the administrator account. Microsoft Graph data-access permissions are not required.

## Microsoft Active Directory

AD authentication is implemented through LDAPS but has not yet been integration-tested against a real domain controller.

Set the following values in `.env`:

```dotenv
LDAP_HOST=dc.example.local
LDAP_PORT=636
LDAP_BASE_DN=DC=example,DC=local
LDAP_BIND_DN=CN=svc-datatlas,OU=Service Accounts,DC=example,DC=local
LDAP_BIND_PASSWORD=your-service-account-password
LDAP_CA_FILE=/certs/ad-ca.pem
```

Provide the CA file through an additional read-only Compose mount, such as `./certs/ad-ca.pem:/certs/ad-ca.pem:ro`. The service account needs only read permissions for user lookup.

Users sign in with their `sAMAccountName` and AD password over TLS with certificate validation; unencrypted LDAP is not supported. Assign roles and source grants in DatAtlas after the first sign-in. AD passwords are not stored in the application database.

## Backup and restore

`scripts/backup.sh` creates a consistent logical dump of the application's MariaDB database. Store the output on a protected backup volume:

```bash
./scripts/backup.sh /secure/path/datatlas-backups
```

Also back up `.env`, or at least its encryption/session secrets, and required SQLite source files separately and securely. The dump contains encrypted connection configurations, password hashes, and documentation. Verify backups by restoring them.

First test restoration in an **empty, separate test instance**. Before restoring the live application database, stop the application and deliberately select the backup you want to restore:

```bash
docker compose stop app
gunzip -c /path/to/backup.sql.gz | docker compose exec -T mariadb sh -c 'exec mariadb -udatatlas -p"$MARIADB_PASSWORD" datatlas'
docker compose start app
```

Do not remove Docker volumes with `docker compose down -v` if you want to retain application data.

## Development and verification

The backend uses FastAPI and SQLAlchemy. The German-language interface uses locally served HTML, CSS, and JavaScript without external CDN dependencies. Container dependencies are pinned in `requirements.lock`; direct requirements are listed in `requirements.txt`.

### Application tests

```bash
docker compose run --rm \
  -v "$PWD/app:/app/app:ro" \
  -v "$PWD/tests:/app/tests:ro" \
  app python -m pytest -q -p no:cacheprovider tests/test_application.py tests/test_catalog_features.py
```

Application tests use temporary SQLite databases for both application storage and sources. They verify encrypted credentials, scanning, metadata, notes, exports, CSRF and Origin checks, roles and source grants, preview authorization, account deactivation, read-only SQLite access, path boundaries, and session revocation. The feature suite additionally covers permission-filtered global search, literal search patterns, note indexing, snapshot/index rollback, schema comparisons, persistent scheduling, duplicate-scan deferral, access revocation, daylight-saving transitions, additive migrations, and cleanup on source deletion.

### Connector integration tests

With `CONNECTOR_INTEGRATION=1`, `tests/test_connectors_integration.py` runs against dedicated disposable containers named `datatlas-test-postgres`, `datatlas-test-mysql`, and `datatlas-test-mongo`, plus a temporary fixture database in the application's MariaDB container. The tests create and remove fixture tables. Do not run them against production databases.

With `MSSQL_INTEGRATION=1`, `tests/test_mssql_integration.py` tests a separate SQL Server 2022 Developer container named `datatlas-test-mssql`, covering database discovery, tables and views, primary and foreign keys, and data previews.

### Browser tests

The browser test requires Node.js, Playwright, and Chromium at `/usr/bin/chromium`:

```bash
npm install --prefix /tmp/datatlas-browser playwright
NODE_PATH=/tmp/datatlas-browser/node_modules node tests/browser.cjs
```

`tests/browser.cjs` checks the development instance and its clearly labeled example source: sign-in, connection testing, schema scanning, ER diagrams, notes, data previews, and mobile layout. It reads the initial administrator password from `.env`, so update the test credentials if you change that password. It modifies only the example source. Screenshots are saved in `docs/`.

### Catalog UI checks

```bash
NODE_PATH=/tmp/datatlas-browser/node_modules node tests/catalog.cjs
```

This additional browser check supplies 67 simulated sources through mocked read-only API responses. It verifies pagination, combined engine/server/status filters, multi-term search, sorting, safe rendering of source names, list/card switching, navigation back to the selected page, all six local logos, mobile layout, and empty catalogs for administrator and viewer roles. It does not create databases or change application records. The screenshots in `docs/catalog-67-sources*.png` show these simulated fixtures.

### Feature UI checks

```bash
NODE_PATH=/tmp/datatlas-browser/node_modules node tests/features.cjs
```

This browser check serves the current local JavaScript/CSS and mocked API responses without changing live records. It exercises tag/owner editing and catalog filters, scan schedule forms, comparison selectors and validation, search results and escaped snippets, reloadable object links, read-only roles, safe note editing during automatic scan completion, and mobile layouts. `docs/automatic-scans.png`, `docs/schema-comparison.png`, `docs/schema-comparison-mobile.png`, and `docs/global-search.png` show simulated feature fixtures.

### Verified deployment

The current feature release passes **15 application and feature tests**, plus catalog and feature browser checks and the live example browser flow. Existing deployment records were verified unchanged during migration. A real scheduled scan of the example database completed against MariaDB-backed application storage; its test schedule was disabled afterward, and the non-example source was verified unchanged.

Earlier adapter verification passed **12 automated tests**, including actual adapter tests against SQL Server 2022, MySQL 8.4, MariaDB 11.4, PostgreSQL 17, MongoDB 8, and SQLite. Browser checks, including mobile layout, and backup/restore into a separate test database also passed. Disposable test containers were removed afterward.

The browser test documents six example objects and four declared relationships. Entra ID and AD authentication still require integration verification with the actual tenant and directory systems.

## References

- [SQLAlchemy: Database reflection](https://docs.sqlalchemy.org/en/20/core/reflection.html)
- [Authlib: OIDC for Starlette](https://docs.authlib.org/en/latest/client/starlette.html)
- [ldap3: TLS and certificate validation](https://ldap3.readthedocs.io/en/latest/ssltls.html)

### Database logo assets

Database-engine logos are vendored from Devicon and served locally. Attribution, source revision, and the upstream MIT license are included in [`app/static/database-logos/`](app/static/database-logos/README.md).
