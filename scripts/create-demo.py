"""Create an explicitly labeled demo source. Does not touch any real database."""

from pathlib import Path
import sqlite3

path = Path(__file__).resolve().parents[1] / "sources" / "beispiel.sqlite"
if path.exists():
    raise SystemExit("Beispieldatei existiert bereits; keine Änderungen durchgeführt.")
with sqlite3.connect(path) as db:
    db.executescript("""
    PRAGMA foreign_keys=ON;
    CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, company VARCHAR(150) NOT NULL, email VARCHAR(190) UNIQUE, country VARCHAR(2) DEFAULT 'DE');
    CREATE TABLE products (product_id INTEGER PRIMARY KEY, sku VARCHAR(30) UNIQUE NOT NULL, name VARCHAR(150) NOT NULL, unit_price DECIMAL(12,2) NOT NULL);
    CREATE TABLE orders (order_id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(customer_id), order_date DATE NOT NULL, status VARCHAR(30) DEFAULT 'open');
    CREATE TABLE order_items (order_id INTEGER NOT NULL REFERENCES orders(order_id), product_id INTEGER NOT NULL REFERENCES products(product_id), quantity INTEGER NOT NULL, unit_price DECIMAL(12,2), PRIMARY KEY (order_id, product_id));
    CREATE TABLE deliveries (delivery_id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(order_id), shipped_at DATETIME, tracking_code VARCHAR(80));
    CREATE INDEX idx_orders_customer ON orders(customer_id);
    CREATE INDEX idx_orders_date ON orders(order_date);
    CREATE VIEW order_summary AS SELECT o.order_id, c.company, o.order_date, o.status, SUM(i.quantity*i.unit_price) AS total FROM orders o JOIN customers c ON c.customer_id=o.customer_id JOIN order_items i ON i.order_id=o.order_id GROUP BY o.order_id;
    INSERT INTO customers VALUES (1,'Beispiel GmbH','kontakt@example.invalid','DE'), (2,'Demo AG','team@example.invalid','AT');
    INSERT INTO products VALUES (1,'DEMO-001','Demoprodukt A',24.90),(2,'DEMO-002','Demoprodukt B',49.50);
    INSERT INTO orders VALUES (1001,1,'2026-10-01','completed'),(1002,2,'2026-10-03','open');
    INSERT INTO order_items VALUES (1001,1,3,24.90),(1001,2,1,49.50),(1002,2,2,49.50);
    INSERT INTO deliveries VALUES (1,1001,'2026-10-02 10:30:00','DEMO-TRACKING-001');
    """)
path.chmod(0o644)
print("Beispieldatenbank erstellt: " + str(path))
