import * as dotenv from 'dotenv';
dotenv.config();

const ssl = ['true', '1', 'yes'].includes(
  (process.env.DB_SSL ?? '').toLowerCase(),
);

export const sequelizeConfig = {
  dialect: 'postgres' as const,
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: parseInt(process.env.DB_PORT ?? '8082', 10),
  username: process.env.DB_USERNAME ?? 'martinrea',
  password: process.env.DB_PASSWORD ?? 'matrinrea_dev_pwd',
  database: process.env.DB_NAME ?? 'appdb',
  logging: false,
  ...(ssl && {
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  }),
};
