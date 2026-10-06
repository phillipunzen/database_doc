"""Execute generated DDL only in dedicated disposable engine containers."""

import os
import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError
from app.warehouse import ProjectInput, sql_script, compare_target
from app.connectors import scan
from test_warehouse import blueprint

kind = os.getenv("WAREHOUSE_TEST_ENGINE")
pytestmark = pytest.mark.skipif(
    kind not in {"postgresql", "mariadb", "mssql"},
    reason="Requires dedicated disposable warehouse DDL containers",
)


def test_generated_ddl_creates_matching_model_and_validates_foreign_key():
    schema = "databasedoc_ddl_fixture"
    credentials = {
        "password": "Dwh-disposable-test-password-2026",
        "database": schema,
        "tls": False,
    }
    if kind == "postgresql":
        credentials.update(
            host="databasedoc-ddl-postgres", username="postgres", port=5432
        )
        url = URL.create(
            "postgresql+psycopg", **{k: v for k, v in credentials.items() if k != "tls"}
        )
    elif kind == "mariadb":
        credentials.update(host="databasedoc-ddl-mariadb", username="root", port=3306)
        url = URL.create(
            "mysql+pymysql", **{k: v for k, v in credentials.items() if k != "tls"}
        )
    else:
        credentials.update(host="databasedoc-ddl-mssql", username="sa", port=1433)
        master = URL.create(
            "mssql+pyodbc",
            username="sa",
            password=credentials["password"],
            host=credentials["host"],
            port=1433,
            database="master",
            query={
                "driver": "ODBC Driver 18 for SQL Server",
                "Encrypt": "no",
                "TrustServerCertificate": "yes",
            },
        )
        setup = create_engine(master, isolation_level="AUTOCOMMIT")
        with setup.connect() as c:
            c.exec_driver_sql(f"DROP DATABASE IF EXISTS [{schema}]")
            c.exec_driver_sql(f"CREATE DATABASE [{schema}]")
        setup.dispose()
        url = master.set(database=schema)
    data = blueprint(kind)
    data["target_schema"] = schema
    plan = ProjectInput.model_validate(data)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            if kind == "postgresql":
                conn.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            elif kind == "mariadb":
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{schema}`.`fact_sales`")
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{schema}`.`dim_customer`")
            for statement in "\n".join(
                line
                for line in sql_script(plan).splitlines()
                if not line.startswith("--")
            ).split(";"):
                if statement.strip():
                    conn.exec_driver_sql(statement)
            inspector = inspect(conn)
            assert sorted(inspector.get_table_names(schema=schema)) == [
                "dim_customer",
                "fact_sales",
            ]
            fk = inspector.get_foreign_keys("fact_sales", schema=schema)
            assert fk[0]["constrained_columns"] == ["customer_id"]
            assert fk[0]["referred_table"] == "dim_customer"
            dim = f"{schema}.dim_customer"
            fact = f"{schema}.fact_sales"
            conn.execute(
                text(f"INSERT INTO {dim} (customer_code) VALUES ('fictional-customer')")
            )
            conn.execute(
                text(
                    f"INSERT INTO {fact} (customer_id,amount,date,loaded_at,active) VALUES (1,12.50,'2026-10-06','2026-10-06 12:00:00',1)"
                    if kind != "postgresql"
                    else f"INSERT INTO {fact} (customer_id,amount,date,loaded_at,active) VALUES (1,12.50,'2026-10-06','2026-10-06 12:00:00',TRUE)"
                )
            )
        payload = scan(kind, {**credentials, "schema": schema})
        from types import SimpleNamespace

        result = compare_target(
            plan, SimpleNamespace(id=1, created="fixture", payload=payload)
        )
        assert result["matched"] == 2, result
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"INSERT INTO {fact} (customer_id,amount,date,loaded_at,active) VALUES (999,1.00,'2026-10-06','2026-10-06 12:00:00',1)"
                        if kind != "postgresql"
                        else f"INSERT INTO {fact} (customer_id,amount,date,loaded_at,active) VALUES (999,1.00,'2026-10-06','2026-10-06 12:00:00',TRUE)"
                    )
                )
    finally:
        engine.dispose()
