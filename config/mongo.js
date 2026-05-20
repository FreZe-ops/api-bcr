const mongoose = require('mongoose')
mongoose.set('strictQuery', true)
require('dotenv').config()

async function connect() {
    try {
        mongoose.connect(process.env.URL_CONNECT_MONGODB, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        })
            .then(() => console.info(`🛢️🛢️🛢️ connect database success`))
            .catch(err => console.error('🛠🛠🛠 : ' + err));
    } catch (error) {
        console.info(`❌❌❌ connect DB failure`);
        console.error(error);
    }
}

module.exports = { connect };