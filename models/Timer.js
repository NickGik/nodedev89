const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TimerSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  description: { type: String, required: true },
  start: { type: Date, required: true },
  end: { type: Date },
  duration: { type: Number },
  isActive: { type: Boolean, default: true },
  progress: { type: Number }
});

const Timer = mongoose.model('Timer', TimerSchema);

module.exports = Timer;
