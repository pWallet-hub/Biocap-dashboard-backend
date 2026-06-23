const mongoose = require('mongoose');

// Matches the `sessions` array shape used in ProjectModal: { role, name, summary }
const SessionSchema = new mongoose.Schema(
  {
    role: { type: String, required: true },
    name: { type: String, required: true },
    summary: { type: String },
  },
  { _id: false }
);

// Matches the nested `modal` object on the frontend Project type
const ModalSchema = new mongoose.Schema(
  {
    date: { type: String },
    organizer: { type: String },
    partners: { type: String },
    intro: { type: String, required: true },
    objectives: { type: [String], default: [] },
    sessions: { type: [SessionSchema], default: [] },
    collaboration: { type: [String], default: [] },
    quote: { type: String },
    quoteSource: { type: String },
  },
  { _id: false }
);

const BlogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    img: { type: String, required: true },       // header/cover image shown in the modal
    tag: { type: String, required: true },        // small badge label e.g. "Workshop"
    modal: { type: ModalSchema, required: true }, // everything rendered inside ProjectModal
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true, // gives us createdAt for sorting by recent posts
  }
);

module.exports = mongoose.model('Blog', BlogSchema);