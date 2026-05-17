const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

const DB_FILE = path.join(__dirname, 'database.json');

// MongoDB Setup
const MONGODB_URI = process.env.MONGODB_URI;
let useMongoDB = false;

if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI)
        .then(() => {
            console.log('Successfully connected to MongoDB Cloud Database!');
            useMongoDB = true;
        })
        .catch(err => {
            console.error('MongoDB Connection Error, falling back to database.json:', err.message);
        });
} else {
    console.log('No MONGODB_URI environment variable found. Using local database.json storage.');
}

// Schemas & Models
const profileSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    name: String,
    address: String,
    phone: String
});
const Profile = mongoose.models.Profile || mongoose.model('Profile', profileSchema);

const orderSchema = new mongoose.Schema({
    email: { type: String, required: true },
    order: {
        id: Number,
        itemName: String,
        price: String,
        total: Number,
        date: String,
        deliveryAddress: String
    }
});
const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

const productSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    price: String,
    image: String,
    category: String
});
const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

// Database Adapter Helpers
async function getProfile(email) {
    if (useMongoDB) {
        return await Profile.findOne({ email });
    } else {
        const db = readDB();
        return db.profiles[email];
    }
}

async function saveProfile(email, name, address, phone) {
    if (useMongoDB) {
        return await Profile.findOneAndUpdate(
            { email },
            { email, name, address, phone },
            { upsert: true, new: true }
        );
    } else {
        const db = readDB();
        db.profiles[email] = { email, name, address, phone };
        writeDB(db);
        return db.profiles[email];
    }
}

async function getOrders(email) {
    if (useMongoDB) {
        const orders = await Order.find({ email });
        return orders.map(o => o.order);
    } else {
        const db = readDB();
        return db.orders[email] || [];
    }
}

async function saveOrder(email, order) {
    if (useMongoDB) {
        const newOrder = new Order({ email, order });
        await newOrder.save();
        const allOrders = await Order.find({ email });
        return allOrders.map(o => o.order);
    } else {
        const db = readDB();
        if (!db.orders[email]) {
            db.orders[email] = [];
        }
        db.orders[email].push(order);
        writeDB(db);
        return db.orders[email];
    }
}

async function getProducts() {
    if (useMongoDB) {
        return await Product.find({});
    } else {
        const db = readDB();
        return db.products || [];
    }
}

async function saveProduct(productData) {
    if (useMongoDB) {
        const newProduct = new Product(productData);
        await newProduct.save();
        return await Product.find({});
    } else {
        const db = readDB();
        db.products.push(productData);
        writeDB(db);
        return db.products;
    }
}

// Store active OTPs temporarily
const activeOTPs = {};

// Configure Nodemailer with an automatic test account (Ethereal)
let transporter;
nodemailer.createTestAccount((err, account) => {
    if (err) {
        console.error('Failed to create a testing account. ' + err.message);
        return;
    }
    transporter = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: {
            user: account.user,
            pass: account.pass
        }
    });
    console.log('Test Email Account Created successfully!');
});

// Initialize DB if it doesn't exist
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ profiles: {}, orders: {}, products: [] }));
}

function readDB() {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    const db = JSON.parse(data);
    if (!db.products) db.products = []; // Migration for existing db
    return db;
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Routes
app.post('/api/send-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    // Generate 4 digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    activeOTPs[email] = otp;

    try {
        if (!transporter) throw new Error("Transporter not ready");

        let info = await transporter.sendMail({
            from: '"BUY ZONE" <no-reply@buyzone.com>',
            to: email,
            subject: 'Your BUY ZONE Login OTP',
            text: `Your login OTP is: ${otp}`,
            html: `<h3>Welcome to BUY ZONE</h3><p>Your login OTP is: <b style="font-size:20px;">${otp}</b></p><p>If you did not request this, please ignore this email.</p>`
        });
        
        const emailUrl = nodemailer.getTestMessageUrl(info);
        
        // Remove OTP after 5 minutes
        setTimeout(() => { delete activeOTPs[email]; }, 5 * 60 * 1000);
        
        console.log(`OTP for ${email} is ${otp}`);
        console.log(`Preview Email URL: ${emailUrl}`);
        res.json({ success: true, message: 'OTP sent successfully', emailUrl });
    } catch (error) {
        console.error('Email error:', error);
        // Fallback for demo if credentials aren't set
        console.log(`[FALLBACK] OTP for ${email} is ${otp}`);
        res.json({ success: true, message: 'OTP sent (Check server console if email failed)' });
    }
});

app.post('/api/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    if (activeOTPs[email] && activeOTPs[email] === otp) {
        delete activeOTPs[email];
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Invalid or expired OTP' });
    }
});

app.post('/api/profile', async (req, res) => {
    const { email, name, address, phone } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const profile = await saveProfile(email, name, address, phone);
        res.json({ success: true, profile });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save profile' });
    }
});

app.get('/api/profile/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const profile = await getProfile(email);
        if (profile) {
            res.json({ profile });
        } else {
            res.status(404).json({ error: 'Profile not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve profile' });
    }
});

app.post('/api/orders', async (req, res) => {
    const { email, order } = req.body;
    if (!email || !order) return res.status(400).json({ error: 'Missing data' });

    try {
        const updatedOrders = await saveOrder(email, order);

        // Send email notification to Admin & Buyer
        try {
            if (transporter) {
                const adminEmail = 'kushwahgourav54@gmail.com';
                
                // Email to Admin
                let adminMailInfo = await transporter.sendMail({
                    from: '"BUY ZONE System" <no-reply@buyzone.com>',
                    to: adminEmail,
                    subject: `🚨 New Order Placed! Order ID: #${order.id}`,
                    html: `
                        <h2>New Order Alert!</h2>
                        <p>A new order has been placed on <b>BUY ZONE</b>.</p>
                        <hr/>
                        <h3>Order Details:</h3>
                        <ul>
                            <li><b>Order ID:</b> #${order.id}</li>
                            <li><b>Product:</b> ${order.itemName}</li>
                            <li><b>Price:</b> ₹${order.price}</li>
                            <li><b>Total Paid:</b> ₹${order.total}</li>
                            <li><b>Date:</b> ${order.date}</li>
                        </ul>
                        <h3>Delivery Details:</h3>
                        <ul>
                            <li><b>Buyer Email:</b> ${email}</li>
                            <li><b>Address:</b> ${order.deliveryAddress}</li>
                        </ul>
                    `
                });
                console.log(`[Admin Order Email Sent] URL: ${nodemailer.getTestMessageUrl(adminMailInfo)}`);

                // Email to Buyer
                let buyerMailInfo = await transporter.sendMail({
                    from: '"BUY ZONE" <no-reply@buyzone.com>',
                    to: email,
                    subject: `🎉 Your BUY ZONE Order Confirmed! #${order.id}`,
                    html: `
                        <h2>Order Confirmed!</h2>
                        <p>Thank you for shopping with us, <b>${order.itemName}</b> is on its way!</p>
                        <hr/>
                        <h3>Order Summary:</h3>
                        <ul>
                            <li><b>Order ID:</b> #${order.id}</li>
                            <li><b>Product:</b> ${order.itemName}</li>
                            <li><b>Total Amount:</b> ₹${order.total}</li>
                            <li><b>Delivery Address:</b> ${order.deliveryAddress}</li>
                        </ul>
                        <p>We hope you enjoy your purchase!</p>
                    `
                });
                console.log(`[Buyer Order Email Sent] URL: ${nodemailer.getTestMessageUrl(buyerMailInfo)}`);
            }
        } catch (error) {
            console.error('Failed to send order email notification:', error);
        }

        res.json({ success: true, orders: updatedOrders });
    } catch (err) {
        res.status(500).json({ error: 'Failed to place order' });
    }
});

app.get('/api/orders/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const orders = await getOrders(email);
        res.json({ orders });
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve orders' });
    }
});

app.get('/api/products', async (req, res) => {
    try {
        const products = await getProducts();
        res.json({ products });
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve products' });
    }
});

app.post('/api/products', async (req, res) => {
    const { product } = req.body;
    if (!product) return res.status(400).json({ error: 'Missing product data' });

    try {
        const updatedProducts = await saveProduct(product);
        res.json({ success: true, products: updatedProducts });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save product' });
    }
});

// Default route to serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'buyzone_complete_modified_html.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
