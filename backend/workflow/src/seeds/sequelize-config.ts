import * as dotenv from 'dotenv';
dotenv.config();

const ssl = ['true', '1', 'yes'].includes(
  (process.env.DB_SSL ?? '').toLowerCase(),
);

export const sequelizeConfig = {
  dialect: 'postgres' as const,
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'martinrea',
  password: process.env.DB_PASSWORD ?? 'martinrea_dev_pwd',
  database: process.env.DB_NAME ?? 'martinrea_ap',
  logging: false,
  ...(ssl && {
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  }),
};
