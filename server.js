const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use(express.static(path.join(__dirname, '.')));

// ================= CONFIGURAÇÃO DO MYSQL =================
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'C@tw2016', 
    database: 'catalogo_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Criação automática da tabela de pedidos
(async () => {
    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS pedidos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome_cliente VARCHAR(255) NOT NULL,
                endereco TEXT NOT NULL,
                whatsapp VARCHAR(20),
                observacoes TEXT,
                itens TEXT,
                total DECIMAL(10, 2),
                link_pagamento TEXT,
                status VARCHAR(50) DEFAULT 'Pendente',
                data_pedido DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Tabela "pedidos" garantida no MySQL.');
    } catch (err) {
        console.error('❌ Erro ao criar tabela de pedidos:', err.message);
    }
})();

// Criação automática da coluna de link de pagamento nos produtos
(async () => {
    try {
        const [colunas] = await pool.execute(`SHOW COLUMNS FROM produtos LIKE 'link_pagamento'`);
        if (colunas.length === 0) {
            await pool.execute(`ALTER TABLE produtos ADD COLUMN link_pagamento TEXT`);
            console.log('✅ Coluna "link_pagamento" adicionada com sucesso!');
        } else {
            console.log('✅ Coluna "link_pagamento" já existe.');
        }
    } catch (err) {
        console.error('❌ Erro ao tentar adicionar coluna:', err.message);
    }
})();

// ================= CONFIGURAÇÃO DO UPLOAD (MULTER) =================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ================= PROTEÇÃO (MIDDLEWARE) =================
function verificarAdmin(req, res, next) {
    const adminToken = req.headers['x-admin-token'];
    if (adminToken === 'admin123') { // ⚠️ Mesma senha
        next();
    } else {
        return res.status(401).json({ error: "Acesso negado. Faça login primeiro." });
    }
}

// ================= ROTAS PÚBLICAS (Clientes) =================

// 1. Listar produtos (Público - usado pela loja)
app.get('/api/produtos', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM produtos');
        res.json(rows);
    } catch (err) {
        console.error("Erro no MySQL:", err);
        res.status(500).json({ error: err.message });
    }
});

// 2. Buscar produto por ID (Público - usado pela loja)
app.get('/api/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute('SELECT * FROM produtos WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Produto não encontrado" });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Buscar produtos por nome (Público)
app.get('/api/buscar', async (req, res) => {
    try {
        const { q } = req.query;
        const [rows] = await pool.execute('SELECT * FROM produtos WHERE nome LIKE ?', [`%${q}%`]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Criar pedido (PÚBLICO - O CLIENTE USA)
app.post('/api/pedidos', async (req, res) => {
    try {
        const { nome, endereco, whatsapp, observacoes, itens, total } = req.body;
        const whatsappLimpo = (whatsapp || '').replace(/[^\d]/g, '');
        const sql = 'INSERT INTO pedidos (nome_cliente, endereco, whatsapp, observacoes, itens, total) VALUES (?, ?, ?, ?, ?, ?)';
        const values = [nome, endereco, whatsappLimpo || null, observacoes || null, JSON.stringify(itens), parseFloat(total)];
        const [result] = await pool.execute(sql, values);
        res.status(201).json({ id: result.insertId, mensagem: "Pedido salvo com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Finalizar via WhatsApp (PÚBLICO - O CLIENTE USA)
app.post('/api/pedidos/whatsapp', async (req, res) => {
    try {
        const { nome, endereco, whatsapp, observacoes, itens, total } = req.body;
        const whatsappLimpo = (whatsapp || '').replace(/[^\d]/g, '');
        const sql = 'INSERT INTO pedidos (nome_cliente, endereco, whatsapp, observacoes, itens, total) VALUES (?, ?, ?, ?, ?, ?)';
        const values = [nome, endereco, whatsappLimpo || null, observacoes || null, JSON.stringify(itens), parseFloat(total)];
        const [result] = await pool.execute(sql, values);

        const listaItens = itens.map(item => `• ${item.nome} (x${item.qtd}) - R$ ${(item.preco * item.qtd).toFixed(2)}`).join('\n');
        const mensagem = `Olá! Quero fazer um pedido:\n\n*Dados do Cliente:*\n👤 Nome: ${nome}\n📍 Endereço: ${endereco}\n📱 WhatsApp: ${whatsapp || 'Não informado'}\n\n*Itens do Pedido:*\n${listaItens}\n\n💰 *Total: R$ ${total.toFixed(2)}*\n\nAguardo a confirmação!`;
        
        const numeroLoja = "5588993754503"; // ⚠️ TROQUE PELO SEU NÚMERO
        const url = `https://wa.me/${numeroLoja}?text=${encodeURIComponent(mensagem)}`;
        
        res.status(201).json({ url, pedidoId: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= ROTAS PROTEGIDAS (Somente Admin) =================

// 1. Listar pedidos (PROTEGIDO)
app.get('/api/pedidos', verificarAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM pedidos ORDER BY data_pedido DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Atualizar link de pagamento (PROTEGIDO)
app.put('/api/pedidos/:id/pagamento', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { link_pagamento } = req.body;
        const sql = 'UPDATE pedidos SET link_pagamento = ? WHERE id = ?';
        await pool.execute(sql, [link_pagamento, id]);
        res.json({ mensagem: "Link de pagamento atualizado!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Enviar link para o WhatsApp do cliente (PROTEGIDO)
app.post('/api/pedidos/:id/enviar-whatsapp', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { link_pagamento } = req.body;
        const [rows] = await pool.execute('SELECT whatsapp FROM pedidos WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: "Pedido não encontrado" });

        let numeroCliente = rows[0].whatsapp || '';
        numeroCliente = numeroCliente.replace(/[^\d]/g, '');
        if (!numeroCliente.startsWith('55')) {
            numeroCliente = '55' + numeroCliente;
        }
        if (!numeroCliente || numeroCliente.length < 10) {
            return res.status(400).json({ error: "Número de WhatsApp inválido no cadastro do cliente." });
        }

        const mensagem = `Olá! Recebemos seu pedido. Para pagar, acesse este link: ${link_pagamento}`;
        const urlWhatsApp = `https://wa.me/${numeroCliente}?text=${encodeURIComponent(mensagem)}`;
        res.json({ url: urlWhatsApp });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Sugerir link do produto (PROTEGIDO)
app.get('/api/pedidos/:id/sugerir-link', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const [pedidos] = await pool.execute('SELECT itens FROM pedidos WHERE id = ?', [id]);
        if (pedidos.length === 0) return res.status(404).json({ error: "Pedido não encontrado" });
        const itens = JSON.parse(pedidos[0].itens || '[]');
        if (itens.length === 0) return res.json({ link: null });
        const primeiroProdutoId = itens[0].id;
        const [produtos] = await pool.execute('SELECT link_pagamento FROM produtos WHERE id = ?', [primeiroProdutoId]);
        if (produtos.length === 0) return res.json({ link: null });
        res.json({ link: produtos[0].link_pagamento || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Excluir pedido (PROTEGIDO)
app.delete('/api/pedidos/:id', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const sql = 'DELETE FROM pedidos WHERE id = ?';
        await pool.execute(sql, [id]);
        res.json({ mensagem: "Pedido excluído com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Atualizar status do pedido (PROTEGIDO)
app.put('/api/pedidos/:id/status', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const sql = 'UPDATE pedidos SET status = ? WHERE id = ?';
        await pool.execute(sql, [status, id]);
        res.json({ mensagem: "Status atualizado com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Cadastrar produto (PROTEGIDO - Somente Admin)
app.post('/api/produtos', verificarAdmin, upload.array('fotos', 5), async (req, res) => {
    try {
        const { nome, categoria, preco, descricao, link_pagamento } = req.body;
        const fotos = req.files.map(file => `/uploads/${file.filename}`);
        const sql = 'INSERT INTO produtos (nome, categoria, preco, descricao, fotos, link_pagamento) VALUES (?, ?, ?, ?, ?, ?)';
        const values = [nome, categoria, parseFloat(preco), descricao, JSON.stringify(fotos), link_pagamento || null];
        const [result] = await pool.execute(sql, values);
        res.status(201).json({ id: result.insertId, mensagem: "Produto cadastrado com sucesso!" });
    } catch (err) {
        console.error("Erro ao cadastrar:", err);
        res.status(500).json({ error: err.message });
    }
});

// 8. Atualizar produto (PROTEGIDO - Somente Admin)
app.put('/api/produtos/:id', verificarAdmin, upload.array('fotos', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, categoria, preco, descricao, link_pagamento } = req.body;
        const [rows] = await pool.execute('SELECT fotos FROM produtos WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: "Produto não encontrado" });
        let fotos = JSON.parse(rows[0].fotos || '[]');
        if (req.files && req.files.length > 0) {
            const novasFotos = req.files.map(file => `/uploads/${file.filename}`);
            fotos = [...fotos, ...novasFotos];
        }
        const sql = 'UPDATE produtos SET nome = ?, categoria = ?, preco = ?, descricao = ?, fotos = ?, link_pagamento = ? WHERE id = ?';
        await pool.execute(sql, [nome, categoria, parseFloat(preco), descricao, JSON.stringify(fotos), link_pagamento || null, id]);
        res.json({ mensagem: "Produto atualizado com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9. Excluir produto (PROTEGIDO - Somente Admin)
app.delete('/api/produtos/:id', verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute('SELECT fotos FROM produtos WHERE id = ?', [id]);
        if (rows.length > 0) {
            const fotos = JSON.parse(rows[0].fotos || '[]');
            fotos.forEach(fotoUrl => {
                const caminho = path.join(__dirname, fotoUrl);
                if (fs.existsSync(caminho)) fs.unlinkSync(caminho);
            });
        }
        await pool.execute('DELETE FROM produtos WHERE id = ?', [id]);
        res.json({ mensagem: "Produto excluído com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= ROTAS DE PÁGINAS =================

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send(`ERRO: Arquivo "index.html" não encontrado.`);
    }
});

// Rota para acessar o admin (NÃO PROTEGIDA - O HTML É PÚBLICO, MAS OS DADOS SÃO PROTEGIDOS)
app.get('/admin', (req, res) => {
    const adminPath = path.join(__dirname, 'admin.html');
    if (fs.existsSync(adminPath)) {
        res.sendFile(adminPath);
    } else {
        res.status(404).send(`ERRO: Arquivo "admin.html" não encontrado.`);
    }
});

// Rota para servir a página de login
app.get('/login', (req, res) => {
    const loginPath = path.join(__dirname, 'login.html');
    if (fs.existsSync(loginPath)) {
        res.sendFile(loginPath);
    } else {
        res.status(404).send(`ERRO: Arquivo "login.html" não encontrado.`);
    }
});

// ================= INICIA O SERVIDOR =================
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
    console.log(`👉 Acesse: http://localhost:${PORT}/ para ver a página inicial.`);
});