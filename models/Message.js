import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    groupName: {
      type: String,
      required: true,
      index: true,
    },
    groupKey: {
      type: String,
      required: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Message", messageSchema);
