const config = require('../../config');

function validateTimeWindow(req, res, next) {
    // Dev override: bypass time gate entirely when DEV_OVERRIDE=true in .env
    if (config.devOverride && config.isDevelopment) return next();
    
    // Legacy spoof-mode header (triple-click moon / ?dev button)
    if (req.headers['x-spoof-mode'] === 'true' && (config.isDevelopment || config.isTest)) {
        return next();
    }
    
    const now = new Date();
    const total = now.getHours() * 60 + now.getMinutes();
    const open = config.channel.openHour * 60 + config.channel.openMinute;
    const close = config.channel.closeHour * 60 + config.channel.closeMinute;
    
    if (total >= open && total < close) return next();
    
    res.status(403).json({
        error: {
            message: 'Channel is closed',
            details: `The 3AM Channel is only open between ${config.channel.openHour}:00 AM - ${config.channel.closeHour}:00 AM`
        }
    });
}

module.exports = {
    validateTimeWindow
};
