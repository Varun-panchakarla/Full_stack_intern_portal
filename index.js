import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // for serving static assets (images, css, etc.)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// PostgreSQL pool
const pool = new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Session middleware with fallback secret
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret', // fallback for Render crash
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 6, // 6 hours
        sameSite: 'lax'
    }
}));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); // file in root
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html')); // file in root
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html')); // file in root
});

app.get('/donate', (req, res) => {
    res.render('donate');
});

app.get('/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.name, u.referal_code, COALESCE(SUM(d.amount), 0) as total_raised
            FROM users u
            LEFT JOIN donations d ON u.referal_code = d.referal_code
            GROUP BY u.name, u.referal_code
            ORDER BY total_raised DESC
        `);
        res.render('leader', {
            leaderboard: result.rows,
            user: req.session.user || { name: 'Guest' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error: ' + err.message);
    }
});

app.post('/register', async (req, res) => {
    const { name, Phone, email, password, confirm_password } = req.body;

    if (!email.includes('@') || !email.includes('.')) {
        return res.send('Invalid email');
    }

    if (password !== confirm_password) {
        return res.send('Passwords do not match');
    }

    const referal_code = `${name}2025`;

    try {
        await pool.query(
            'INSERT INTO users (name, phone, email, password, referal_code) VALUES ($1, $2, $3, $4, $5)',
            [name, Phone, email, password, referal_code]
        );
        res.redirect('/login');
    } catch (err) {
        if (err.code === '23505') {
            return res.send('Email or referral code already registered');
        }
        res.send('Database error: ' + err.message);
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.send('Please enter both email and password.');
    }

    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND password = $2',
            [email, password]
        );

        if (result.rows.length > 0) {
            req.session.user = result.rows[0];
            res.redirect('/profile');
        } else {
            res.send('Invalid email or password.');
        }
    } catch (err) {
        res.send('Database error: ' + err.message);
    }
});

app.get('/profile', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const referal_code = req.session.user.referal_code;

    try {
        const result = await pool.query(
            'SELECT SUM(amount) AS total FROM donations WHERE referal_code = $1',
            [referal_code]
        );

        const total_donations = result.rows[0].total || 0;

        res.render('profile', {
            user: req.session.user,
            total_donations
        });
    } catch (err) {
        res.send('Database error: ' + err.message);
    }
});

app.post('/donate', async (req, res) => {
    const { name, email, amount, referal_code } = req.body;
    const date = new Date().toISOString().slice(0, 19).replace('T', ' ');

    try {
        await pool.query(
            'INSERT INTO donations (name, email, amount, referal_code, date) VALUES ($1, $2, $3, $4, $5)',
            [name, email, amount, referal_code, date]
        );
        res.redirect('/donate');
    } catch (err) {
        console.error(err);
        if (err.code === '23503') {
            return res.send('Referral code does not exist.');
        }
        res.send('Database error: ' + err.message);
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
