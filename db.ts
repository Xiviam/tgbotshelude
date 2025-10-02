import { Sequelize, DataTypes } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

export const sequelize = new Sequelize(
  process.env.DB_NAME!,
  process.env.DB_USER!,
  process.env.DB_PASS!,
  {
    host: process.env.DB_HOST!,
    dialect: "mysql",
    logging: console.log, // включено для отладки
  }
);

export const User = sequelize.define(
  "User",
  {
    chatId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      unique: true,
      primaryKey: true,
    },
    login: { type: DataTypes.STRING, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    accessToken: { type: DataTypes.STRING, allowNull: true },
    refreshToken: { type: DataTypes.STRING, allowNull: true },
    expiresAt: { type: DataTypes.BIGINT, allowNull: true },
    city_data: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    tableName: "Users",
    timestamps: true,
  }
);
