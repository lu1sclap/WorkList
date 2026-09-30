const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 建立或連接到 database.sqlite 檔案
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('資料庫連接失敗:', err.message);
    } else {
        console.log('成功連接到 SQLite 資料庫');
    }
});

// 初始化資料庫表格
db.serialize(() => {
    // 1. 使用者表 (users)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 2. 工作清單表 (work_lists) - 由 admin 建立
    db.run(`CREATE TABLE IF NOT EXISTS work_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
    )`);

    // 3. 工作項目表 (work_items)
    db.run(`CREATE TABLE IF NOT EXISTS work_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_list_id INTEGER,
        content TEXT NOT NULL,
        FOREIGN KEY (work_list_id) REFERENCES work_lists(id) ON DELETE CASCADE
    )`);

    // 4. 使用者工作進度表 (user_work_progress)
    db.run(`CREATE TABLE IF NOT EXISTS user_work_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        work_item_id INTEGER,
        status TEXT NOT NULL CHECK(status IN ('todo', 'in_progress', 'done')) DEFAULT 'todo',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
    )`);
});

module.exports = db;