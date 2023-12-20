require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const mysql = require('mysql');
const pool = mysql.createPool({
    connectionLimit: 10,
    host: 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

function fetchCities(chatId) {
    pool.query('SELECT name FROM Cities', (err, results) => {
        if (err) {
            console.error('Error executing query:', err);
            return;
        }

        const keyboard = results.map(city => [{ text: city.name, callback_data: city.name }]);
        
        bot.sendMessage(chatId, 'Select a city:', {
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    });
}

function fetchRecommendations() {
    const joinQuery = `
        SELECT Recommendations.name, Cities.name AS city, Categories.name AS category
        FROM Recommendations
        JOIN Cities ON Recommendations.city_id = Cities.city_id
        JOIN Categories ON Recommendations.category_id = Categories.category_id;
    `;
    pool.query(joinQuery, (err, results) => {
        if (err) {
            console.error('Error executing join query:', err);
            return;
        }
        console.log('Fetched Recommendations:', results);
    });
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Welcome! I am a recommendation bot. Please send me a location, and I'll suggest places to visit like restaurants, bars, etc.");
    fetchCities(chatId);
});

bot.onText(/\/getcities/, (msg) => {
    const chatId = msg.chat.id;
    fetchCities(chatId);
});

bot.on('callback_query', (callbackQuery) => {
    const message = callbackQuery.message;
    const city = callbackQuery.data;
    bot.sendMessage(message.chat.id, `You selected: ${city}`);
});