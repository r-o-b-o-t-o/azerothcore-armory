import { Pool } from "mysql2/promise";
import { Query } from "express-serve-static-core";

export interface IResult {
	recordsTotal: number;
	recordsFiltered: number;
	draw: number;
	data: any[][];
}

export interface IColumnSettings {
	name: string;
	collation?: string;
	formatter?: (data: string | number | null, row: any) => string;
	table?: string;
	database?: string;
}

export interface IColumnJoin {
	table1: string;
	column1: string;
	table2: string;
	column2: string;
	database2?: string;
	kind: "INNER" | "FULL OUTER" | "LEFT" | "RIGHT";
	where?: string;
}

export class DataTablesSsp {
	public draw: number;
	public joins: IColumnJoin[] = [];
	public extraDataColumns: string[] = [];

	private db: Pool;
	private table: string;
	private primaryKey: string;
	private columnSettings: IColumnSettings[];

	private start: number;
	private length: number;
	private _order: {
		column: number,
		dir: string,
	}[];
	private columns: {
		data: number,
		name: string,
		searchable: boolean,
		orderable: boolean,
		search: {
			value: string,
			regex: boolean,
		}
	}[];
	private search: {
		value: string,
		regex: boolean,
	};

	private wheres: string[] = [];
	private filterBindings: (string | number)[] = [];
	private customBindings: (string | number)[] = [];
	private filterWhereSql: string = "1";
	private customWhereSql: string = "1";
	private limitSql: string = "";
	private orderSql: string = "";
	private joinSql: string = "";

	public constructor(query: Query, db: Pool, table: string, primaryKey: string, columnSettings: IColumnSettings[]) {
		this.start = parseInt(query.start as string, 10);
		this.length = parseInt(query.length as string, 10);
		this.draw = parseInt(query.draw as string, 10);
		this._order = (query.order as { column: string, dir: string }[])
			.map(order => { return { column: parseInt(order.column, 10), dir: order.dir, }; });
		this.columns = (query.columns as { data: string, name: string, searchable: string, orderable: string, search: any }[])
			.map(column => {
				return {
					data: parseInt(column.data, 10),
					name: column.name,
					searchable: column.searchable === "true",
					orderable: column.orderable === "true",
					search: { value: column.search.value, regex: column.search.regex === "true" },
				};
			});
		this.search = {
			value: (query.search as any).value as string,
			regex: (query.search as any).regex === "true",
		};

		this.db = db;
		this.table = table;
		this.primaryKey = primaryKey;
		this.columnSettings = columnSettings;
	}

	private colSettingsToStr(colSettings: IColumnSettings) {
		const db = colSettings.database ? ("`" + colSettings.database + "`.") : "";
		return `${db}\`${colSettings.table || this.table}\`.\`${colSettings.name}\``;
	}

	private limit() {
		if (this.start !== undefined && this.length !== -1) {
			this.limitSql = `LIMIT ${this.length} OFFSET ${this.start}`;
		}
		return this;
	}

	private order() {
		if (this._order === undefined) {
			return this;
		}

		const orderBy = [];
		for (const order of this._order) {
			const requestColumn = this.columns[order.column];
			if (!requestColumn.orderable) {
				continue;
			}

			const colSettings = this.columnSettings[requestColumn.data];
			orderBy.push(`${this.colSettingsToStr(colSettings)} ${order.dir}`);
		}
		orderBy.push(`\`${this.table}\`.\`${this.primaryKey}\``);

		if (orderBy.length > 0) {
			this.orderSql = "ORDER BY " + orderBy.join(", ");
		}

		return this;
	}

	private join() {
		for (const join of this.joins) {
			const db2 = join.database2 ? `\`${join.database2}\`.` : "";
			const where = join.where ? ` ${join.where}` : "";
			this.joinSql += `${join.kind} JOIN ${db2}\`${join.table2}\` ON ${db2}\`${join.table2}\`.\`${join.column2}\` = \`${join.table1}\`.\`${join.column1}\`${where}\n`;
		}

		return this;
	}

	private filter() {
		if (this.search.value?.length > 0) {
			const filterWheres = [];
			this.filterBindings = [];

			for (const col of this.columns) {
				if (!col.searchable) {
					continue;
				}

				const colSettings = this.columnSettings[col.data];
				const collate = colSettings.collation !== undefined ? `COLLATE ${colSettings.collation} ` : "";
				filterWheres.push(`${this.colSettingsToStr(colSettings)} ${collate}LIKE ?`);
				this.filterBindings.push(`%${this.search.value}%`);
			}
			if (filterWheres.length > 0) {
				this.filterWhereSql = "(" + filterWheres.map(w => `(${w})`).join(" OR ") + ")";
			}
		}

		this.customWhereSql = this.wheres.map(w => `(${w})`).join(" AND ");
		return this;
	}

	public sql(): string {
		const columns = [
			...this.columnSettings.map(c => this.colSettingsToStr(c)),
			...this.extraDataColumns,
		];
		return `
			SELECT ${columns.join(", ")}
			FROM ${this.table}
			${this.joinSql}
			WHERE
				${this.filterWhereSql} AND
				${this.customWhereSql}
			${this.orderSql}
			${this.limitSql}
		`;
	}

	private buildTotalCountSql(): string {
		return `
			SELECT COUNT(\`${this.table}\`.\`${this.primaryKey}\`) AS \`count\`
			FROM ${this.table}
			${this.joinSql}
			WHERE ${this.customWhereSql}
		`;
	}

	private buildFilteredCountSql(): string {
		return `
			SELECT COUNT(\`${this.table}\`.\`${this.primaryKey}\`) AS \`count\`
			FROM ${this.table}
			${this.joinSql}
			WHERE
				${this.filterWhereSql} AND
				${this.customWhereSql}
		`;
	}

	public async run(queryTimeout: number = 10_000): Promise<IResult> {
		this.limit()
			.order()
			.join()
			.filter();

		const bindings = [...this.filterBindings, ...this.customBindings];

		let [rows, fields] = await this.db.query({
			sql: this.buildTotalCountSql(),
			values: this.customBindings,
			timeout: queryTimeout,
		});
		const recordsTotal = rows[0].count;

		[rows, fields] = await this.db.query({
			sql: this.buildFilteredCountSql(),
			values: bindings,
			timeout: queryTimeout,
		});
		const recordsFiltered = rows[0].count;

		[rows, fields] = await this.db.query({
			sql: this.sql(),
			rowsAsArray: true,
			values: bindings,
			timeout: queryTimeout,
		});
		rows = (rows as any[][]).map(row => {
			for (let i = 0; i < this.columnSettings.length; ++i) {
				const col = this.columnSettings[i];
				if (col.formatter !== undefined) {
					row[i] = col.formatter(row[i], row);
				}
			}
			return row;
		});

		return {
			recordsTotal,
			recordsFiltered,
			draw: this.draw,
			data: rows,
		};
	}

	public where(condition: string, binding?: string | number) {
		this.wheres.push(condition);
		if (binding !== undefined) {
			this.customBindings.push(binding);
		}
		return this;
	}
}
