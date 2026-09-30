const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const db = require('./database');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cors());

// 啟動時自動建立一個預設的管理員帳號 (admin / admin123)
db.serialize(() => {
    db.get(`SELECT * FROM users WHERE username = ?`, ['admin'], async (err, row) => {
        if (!row) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, 
                ['admin', hashedPassword, 'admin'], 
                (err) => {
                    if (!err) console.log('預設管理員帳號已建立: admin / admin123');
                }
            );
        }
    });
});

// ==================== 1. 使用者註冊與登入 API ====================

// 註冊一般使用者
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: '帳號和密碼不得為空' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'user')`, 
            [username, hashedPassword], 
            function(err) {
                if (err) {
                    return res.status(400).json({ error: '帳號已被註冊' });
                }
                res.json({ message: '註冊成功', userId: this.lastID });
            }
        );
    } catch (error) {
        res.status(500).json({ error: '伺服器錯誤' });
    }
});

// 登入 API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: '帳號或密碼錯誤' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ error: '帳號或密碼錯誤' });
        }

        // 回傳使用者基本資料與角色
        res.json({
            message: '登入成功',
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    });
});

// ==================== 2. Admin 專屬：建立工作清單 ====================
app.post('/api/work-lists', (req, res) => {
    const { title, description, adminId, items } = req.body; // items 是一個包含工作內容字串的陣列

    if (!title || !items || !Array.isArray(items)) {
        return res.status(400).json({ error: '標題與工作項目內容為必填' });
    }

    // 先建立清單
    db.run(`INSERT INTO work_lists (title, description, created_by) VALUES (?, ?, ?)`,
        [title, description, adminId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: '建立清單失敗' });
            }

            const workListId = this.lastID;

            // 批次插入底下的工作項目
            const stmt = db.prepare(`INSERT INTO work_items (work_list_id, content) VALUES (?, ?)`);
            items.forEach(content => {
                stmt.run(workListId, content);
            });
            stmt.finalize();

            res.json({ message: '工作清單建立成功', workListId });
        }
    );
});

// ==================== 3. 取得所有工作清單 ====================
app.get('/api/work-lists', (req, res) => {
    db.all(`SELECT * FROM work_lists ORDER BY created_at DESC`, [], (err, lists) => {
        if (err) {
            return res.status(500).json({ error: '取得清單失敗' });
        }
        res.json(lists);
    });
});

// 取得特定清單的詳細內容（包含工作項目）
app.get('/api/work-lists/:id', (req, res) => {
    const listId = req.params.id;

    db.get(`SELECT * FROM work_lists WHERE id = ?`, [listId], (err, list) => {
        if (err || !list) {
            return res.status(404).json({ error: '找不到該清單' });
        }

        db.all(`SELECT * FROM work_items WHERE work_list_id = ?`, [listId], (err, items) => {
            if (err) {
                return res.status(500).json({ error: '取得項目失敗' });
            }
            res.json({ ...list, items });
        });
    });
});

// ==================== 4. 使用者操作：更新工作項目進度 ====================
app.post('/api/progress', (req, res) => {
    const { userId, workItemId, status } = req.body; // status: 'todo', 'in_progress', 'done'

    if (!['todo', 'in_progress', 'done'].includes(status)) {
        return res.status(400).json({ error: '無效的狀態值' });
    }

    // 檢查是否已經有紀錄，有就更新，沒有就新增
    db.get(`SELECT * FROM user_work_progress WHERE user_id = ? AND work_item_id = ?`, 
        [userId, workItemId], 
        (err, row) => {
            if (row) {
                db.run(`UPDATE user_work_progress SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND work_item_id = ?`,
                    [status, userId, workItemId],
                    (err) => {
                        if (err) return res.status(500).json({ error: '更新進度失敗' });
                        res.json({ message: '進度更新成功' });
                    }
                );
            } else {
                db.run(`INSERT INTO user_work_progress (user_id, work_item_id, status) VALUES (?, ?, ?)`,
                    [userId, workItemId, status],
                    (err) => {
                        if (err) return res.status(500).json({ error: '儲存進度失敗' });
                        res.json({ message: '進度新增成功' });
                    }
                );
            }
        }
    );
});

// 取得特定使用者在某個清單中的所有進度
app.get('/api/progress/:userId/:listId', (req, res) => {
    const { userId, listId } = req.params;

    const query = `
        SELECT p.work_item_id, p.status 
        FROM user_work_progress p
        JOIN work_items i ON p.work_item_id = i.id
        WHERE p.user_id = ? AND i.work_list_id = ?
    `;

    db.all(query, [userId, listId], (err, progress) => {
        if (err) {
            return res.status(500).json({ error: '取得進度失敗' });
        }
        res.json(progress);
    });
});

// ==================== 5. Admin 專屬：查看所有使用者在某個清單的進度 ====================
app.get('/api/admin/progress/:listId', (req, res) => {
    const listId = req.params.listId;

    // 這支 Query 會把「該清單的所有項目」、「所有一般使用者」、以及他們對應的狀態全部撈出來
    const query = `
        SELECT 
            u.id AS user_id,
            u.username,
            i.id AS work_item_id,
            i.content AS work_content,
            COALESCE(p.status, 'todo') AS status
        FROM users u
        CROSS JOIN work_items i
        LEFT JOIN user_work_progress p ON p.user_id = u.id AND p.work_item_id = i.id
        WHERE i.work_list_id = ? AND u.role = 'user'
        ORDER BY u.id, i.id;
    `;

    db.all(query, [listId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: '取得所有使用者進度失敗' });
        }
        res.json(rows);
    });
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`伺服器運行中：http://localhost:${PORT}`);
});