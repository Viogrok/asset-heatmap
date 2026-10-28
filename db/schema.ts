import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const portfolios=sqliteTable('portfolios',{owner:text('owner').primaryKey(),payload:text('payload').notNull(),revision:integer('revision').notNull().default(0)});
export const cache=sqliteTable('quote_cache',{key:text('key').primaryKey(),payload:text('payload').notNull(),updated:integer('updated').notNull()});
export const marketDataLeases=sqliteTable('market_data_leases',{key:text('key').primaryKey(),owner:text('owner').notNull(),expires:integer('expires').notNull()});
export const marketDataBudgets=sqliteTable('market_data_budgets',{key:text('key').primaryKey(),window:integer('window').notNull(),used:integer('used').notNull()});
