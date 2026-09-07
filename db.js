// db.js
const mysql = require('mysql2/promise');

// ⚠️ TROQUE 'sua_senha' PELA SUA SENHA REAL DO MYSQL
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'C@tw2016', 
    database: 'catalogo_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;