// routes/produtos.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db'); // Importa a conexão do db.js

// Configuração do Upload (Multer)
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

// Rota: Listar produtos
router.get('/produtos', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM produtos');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rota: Cadastrar produto com fotos
router.post('/produtos', upload.array('fotos', 5), async (req, res) => {
    try {
        const { nome, categoria, preco, descricao } = req.body;
        const fotos = req.files.map(file => `/uploads/${file.filename}`);

        const sql = 'INSERT INTO produtos (nome, categoria, preco, descricao, fotos) VALUES (?, ?, ?, ?, ?)';
        const values = [nome, categoria, parseFloat(preco), descricao, JSON.stringify(fotos)];

        const [result] = await pool.execute(sql, values);
        res.status(201).json({ id: result.insertId, mensagem: "Produto cadastrado com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;