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

const fs = require('fs');

function addRecommendationWithImageUrl(cityId, categoryId, name, description, address, rating, imageUrl) {
  const query = `INSERT INTO Recommendations (city_id, category_id, name, description, address, rating, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  pool.query(query, [cityId, categoryId, name, description, address, rating, imageUrl], (err, results) => {
      if (err) {
          console.error('Error executing insert query:', err);
          return;
      }
      console.log('Recommendation added with ID:', results.insertId);
  });
}

// addRecommendationWithImageUrl(1, 1, 'Louvre Museum', 'The world\'s largest art museum.', 'Rue de Rivoli, 75001 Paris, France', 4.8, 'https://news.artnet.com/app/news-upload/2022/11/GettyImages-1238211781-scaled.jpg');

let userSessions = {};

function initializeUserSession(chatId) {
    userSessions[chatId] = {
        step: 'initial',
        searchType: null,
        continentId: null,
        countryId: null,
        cityId: null,
        categoryId: null,
        recommendation: null,
        lastMessageId: null
    };
}

function updateUserSession(chatId, key, value) {
  if (userSessions[chatId]) {
      userSessions[chatId][key] = value;
  }
}

function displayInitialOptions(chatId) {
  const keyboard = [
      [{ text: 'Search by Current Location', callback_data: 'search_currentLocation' }],
      [{ text: 'Select Location Manually', callback_data: 'search_selectLocation' }]
  ];
  
  bot.sendMessage(chatId, 'To find you recommendations, pick the option for searching:', {
      reply_markup: { inline_keyboard: keyboard }
  }).then(sentMessage => {
      userSessions[chatId].lastMessageId = sentMessage.message_id;
  });
}

function findClosestCities(chatId, userLat, userLng) {
  const query = `
    SELECT city_id, name, lat, lng, 
    (6371 * acos(cos(radians(?)) * cos(radians(lat)) * cos(radians(lng) - radians(?)) + sin(radians(?)) * sin(radians(lat)))) AS distance 
    FROM Cities 
    ORDER BY distance 
    LIMIT 3;
  `;

  pool.query(query, [userLat, userLng, userLat], (err, results) => {
    if (err) {
      console.error('Error finding closest cities:', err);
      bot.sendMessage(chatId, "Sorry, couldn't find any cities near you.");
      return;
    }
    const locationkeyboard = results.map(city => [{ text: city.name, callback_data: 'city_' + city.city_id }]);
    const backKeyboard = [{ text: '⬅️ Back', callback_data: 'back_location' }];
    const keyboard = [...locationkeyboard, backKeyboard];
    bot.sendMessage(chatId, 'Based on your location, we recommend picking the cities closest to you:', {
        reply_markup: { inline_keyboard: keyboard }
    }).then(sentMessage => {
        userSessions[chatId].lastMessageId = sentMessage.message_id;
    });
  });
}

function fetchContinents(chatId) {
  pool.query('SELECT continent_id, name FROM Continents', (err, results) => {
      if (err) {
          console.error('Error executing query:', err);
          return;
      }
      const keyboard = results.map(continent => [{ text: continent.name, callback_data: 'continent_' + continent.continent_id }]);
      
      bot.sendMessage(chatId, 'Select a continent:', {
          reply_markup: { inline_keyboard: keyboard }
      }).then(sentMessage => {
          userSessions[chatId].lastMessageId = sentMessage.message_id;
      });
  });
}

function fetchCountries(chatId) {
  const continentId = userSessions[chatId].continentId;
  if (!continentId) {
      bot.sendMessage(chatId, 'Error: Continent not selected.');
      return;
  }

  pool.query('SELECT country_id, name FROM Countries WHERE continent_id = ?', [continentId], (err, results) => {
      if (err) {
          console.error('Error executing query:', err);
          return;
      }
      const countryKeyboard = results.map(country => [{ text: country.name, callback_data: 'country_' + country.country_id }]);
      const backKeyboard = [{ text: '⬅️ Back', callback_data: 'back_continent' }];
      const keyboard = [...countryKeyboard, backKeyboard];
      bot.sendMessage(chatId, 'Select a country:', {
          reply_markup: { inline_keyboard: keyboard }
      }).then(sentMessage => {
          userSessions[chatId].lastMessageId = sentMessage.message_id;
      });
  });
}

function fetchCities(chatId) {
  const countryId = userSessions[chatId].countryId;
  if (!countryId) {
      bot.sendMessage(chatId, 'Error: Country not selected.');
      return;
  }

  pool.query('SELECT city_id, name FROM Cities WHERE country_id = ?', [countryId], (err, results) => {
      if (err) {
          console.error('Error executing query:', err);
          return;
      }
      const cityKeyboard = results.map(city => [{ text: city.name, callback_data: 'city_' + city.city_id }]);
      const backKeyboard = [{ text: '⬅️ Back', callback_data: 'back_country' }];
      const keyboard = [...cityKeyboard, backKeyboard];
      bot.sendMessage(chatId, 'Select a city:', {
          reply_markup: { inline_keyboard: keyboard }
      }).then(sentMessage => {
          userSessions[chatId].lastMessageId = sentMessage.message_id;
      });
  });
}

function fetchCategories(chatId) {
  pool.query('SELECT category_id, name FROM Categories', (err, results) => {
      if (err) {
          console.error('Error executing query:', err);
          return;
      }
      const keyboard = results.map(category => [{ text: category.name, callback_data: 'category_' + category.category_id }]);
      
      bot.sendMessage(chatId, 'Select a category:', {
          reply_markup: { inline_keyboard: keyboard }
      }).then(sentMessage => {
          userSessions[chatId].lastMessageId = sentMessage.message_id;
      });
  });
}

function fetchRecommendations(chatId) {
  const session = userSessions[chatId];
  if (!session.cityId || !session.categoryId) {
      bot.sendMessage(chatId, 'Error: City or Category not selected.');
      return;
  }

  const query = `
      SELECT Recommendations.name, Recommendations.description, Recommendations.address, Recommendations.rating, Recommendations.image_url
      FROM Recommendations
      JOIN Cities ON Recommendations.city_id = Cities.city_id
      JOIN Categories ON Recommendations.category_id = Categories.category_id
      WHERE Recommendations.city_id = ? AND Recommendations.category_id = ?
  `;

  pool.query(query, [session.cityId, session.categoryId], (err, results) => {
      if (err) {
          console.error('Error executing recommendations query:', err);
          return;
      }

      if (results.length === 0) {
          bot.sendMessage(chatId, 'No recommendations found for the selected options.');
          return;
      }
      const rec = results[0];
      const recommendationsText = `*${rec.name}*\nDescription: ${rec.description}\nAddress: ${rec.address}\nRating: ${rec.rating}`;
      const keyboard = [[{ text: 'Restart Bot', callback_data: 'restart_bot' }]];
      if (rec.image_url) {
        bot.sendPhoto(chatId, rec.image_url, { 
          caption: recommendationsText,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        });
      } else {
        bot.sendMessage(chatId, `Recommendations:\n\n${recommendationsText}`, { 
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        });
      }
  });
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  initializeUserSession(chatId);
  displayInitialOptions(chatId);
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome to the recommendation bot! You can use this bot to find recommendations for places to visit in a city. All these recommendations are based on my personal experience, so, if you enjoy my vibes, you will love these places. You can search by your current location or select a location manually.');
});

bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (!userSessions[chatId]) {
      initializeUserSession(chatId);
  }
  if (userSessions[chatId].lastMessageId && userSessions[chatId].step !== 'recommendation') {
    bot.deleteMessage(chatId, userSessions[chatId].lastMessageId);
  }

  if (data === 'back_continent') {
    updateUserSession(chatId, 'step', 'continent');
    fetchContinents(chatId);
    return;
  }

  if (data === 'back_country') {
      updateUserSession(chatId, 'step', 'country');
      fetchCountries(chatId);
      return;
  }
  if (data === 'back_location') {
    initializeUserSession(chatId);
    displayInitialOptions(chatId);
    return;
}
  if (data === 'restart_bot') {
    initializeUserSession(chatId);
    displayInitialOptions(chatId);
    return;
  }

  switch (userSessions[chatId].step) {
    case 'initial':
      if (data === 'search_currentLocation') {
        updateUserSession(chatId, 'awaitingLocation', true);
        bot.sendMessage(chatId, 'Please send your location using the paperclip (📎) icon.');
      } else if (data === 'search_selectLocation') {
        updateUserSession(chatId, 'searchType', 'selectLocation');
        updateUserSession(chatId, 'step', 'continent');
        fetchContinents(chatId);
      }
      break;
    case 'continent':
      if (data.startsWith('continent_')) {
        const continentId = data.split('_')[1];
        updateUserSession(chatId, 'continentId', continentId);
        updateUserSession(chatId, 'step', 'country');
        fetchCountries(chatId);
      }  
      break;
    case 'country':
      if (data.startsWith('country_')) {
        const countryId = data.split('_')[1];
        updateUserSession(chatId, 'countryId', countryId);
        updateUserSession(chatId, 'step', 'city');
        fetchCities(chatId);
      }
      break;
    case 'city':  
      if (data.startsWith('city_')) {
        const cityId = data.split('_')[1];
        updateUserSession(chatId, 'cityId', cityId);
        updateUserSession(chatId, 'step', 'category');
        fetchCategories(chatId);
      }
      break;  
    case 'category':
      if (data.startsWith('category_')) {
        const categoryId = data.split('_')[1];
        updateUserSession(chatId, 'categoryId', categoryId);
        updateUserSession(chatId, 'step', 'recommendation');
        fetchRecommendations(chatId);
      }
      break;    
  }
});

bot.on('location', (msg) => {
  const chatId = msg.chat.id;
  if (userSessions[chatId] && userSessions[chatId].awaitingLocation) {
    const { latitude, longitude } = msg.location;
    findClosestCities(chatId, latitude, longitude);
    updateUserSession(chatId, 'awaitingLocation', false);
    updateUserSession(chatId, 'step', 'city');
  }
  else if (!userSessions[chatId].awaitingLocation){
    bot.sendMessage(chatId, 'No need to send location at this moment. Please switch options.');
  }
  else {
    bot.sendMessage(chatId, 'Invalid location received. Please try again.');
  }
});