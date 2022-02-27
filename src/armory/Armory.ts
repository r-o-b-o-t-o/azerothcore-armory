import * as path from "path";
import * as uuid from "uuid";
import { Express } from "express";
import * as express from "express";
import * as winston from "winston";
import * as morgan from "morgan";
import { Connection, createConnection } from "mysql2/promise";
import { engine as handlebarsEngine } from "express-handlebars";

import { Config } from "./Config";
import { DbcManager } from "./data/DbcReader";
import { CharacterCustomization } from "./data/CharacterCustomization";
import { IndexController } from "./controllers/IndexController";
import { CharacterController } from "./controllers/CharacterController";

export class Armory {
	public characterCustomization: CharacterCustomization;
	public dbc: DbcManager;
	public config: Config;
	public worldDb: Connection;
	public logger: winston.Logger;

	private charsDbs: { [key: string]: Connection };
	private errorNames: { [key: number]: string };
	private errorDescriptions: { [key: number]: string };

	public constructor() {
		this.dbc = new DbcManager();
		this.characterCustomization = new CharacterCustomization();
		this.charsDbs = {};
		this.logger = winston.createLogger({
			level: "info",
			format: winston.format.combine(
				winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss:ms" }),
				winston.format.printf((info) => `[${info.timestamp}] [${info.level.toUpperCase()}]: ${info.message}`),
			),
			transports: [
				new winston.transports.Console({ level: "debug" }),
				new winston.transports.File({ filename: "armory.error.log", level: "error" }),
				new winston.transports.File({ filename: "armory.combined.log", level: "http" }),
			],
		});

		this.errorNames = {
			400: "Bad Request",
			401: "Unauthorized",
			403: "Forbidden",
			404: "Not Found",
			500: "Internal Server Error",
		};
		this.errorDescriptions = {
			400: "Invalid request.",
			404: "Sorry, we could not find what you were looking for.",
			500: "An unexpected internal error has occurred. Please contact the site owner.",
		};
	}

	public async start(): Promise<void> {
		const app: Express = express();
		const listenPort = 48733;

		this.logger.info("Loading config...");
		this.config = await Config.load(this.logger);
		this.logger.info("Loading data files...");
		if (this.config.loadDbcs) {
			await this.dbc.loadAllFiles();
		}
		await this.characterCustomization.loadData();

		this.logger.info("Connecting to databases...");
		this.worldDb = await createConnection(this.config.worldDatabase);
		for (const realm of this.config.realms) {
			this.charsDbs[realm.name.toLowerCase()] = await createConnection(realm.charactersDatabase);
		}

		this.logger.info("Starting server...");
		app.locals.aowow = this.config.aowowUrl;
		app.locals.websiteUrl = this.config.websiteUrl;
		app.locals.websiteName = this.config.websiteName;
		app.engine(".html", handlebarsEngine({
			extname: "html",
			partialsDir: path.join(process.cwd(), "static", "partials"),
			layoutsDir: path.join(process.cwd(), "static"),
			defaultLayout: "layout.html",
			helpers: require("handlebars-helpers")(),
		}));
		app.set("view engine", "handlebars");
		app.set("views", path.join(process.cwd(), "static"));

		app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
			req.id = uuid.v4();
			next();
		});

		morgan.token("id", (req: express.Request) => {
			return req.id;
		});
		app.use(morgan(":method :url :status - ID :id - :remote-addr - :response-time ms", {
			stream: {
				write: (msg) => this.logger.http(msg.trim()),
			},
		}));

		app.use("/js", express.static(`static/js`));
		app.use("/css", express.static(`static/css`));
		app.use("/img", express.static(`static/img`));
		app.use("/data/mo3", express.static(`data/mo3`));
		app.use("/data/meta", express.static(`data/meta`));
		app.use("/data/bone", express.static(`data/bone`));
		app.use("/data/textures", express.static(`data/textures`));
		app.use("/data/background.png", express.static(`data/background.png`));

		const indexController = new IndexController(this);
		app.get("/", this.wrapRoute(indexController.index.bind(indexController)));
		app.get("/search", this.wrapRoute(indexController.search.bind(indexController)));

		const charsController = new CharacterController(this);
		await charsController.load();
		app.get("/character/:realm/:name", this.wrapRoute(charsController.character.bind(charsController)));
		app.get("/character/:realm/:name/talents", this.wrapRoute(charsController.talents.bind(charsController)));
		app.get("/character/:realm/:name/achievements", this.wrapRoute(charsController.achievements.bind(charsController)));
		app.get("/character/:realm/:character/achievements/data", this.wrapRoute(charsController.achievementsData.bind(charsController)));

		app.use((err, req: express.Request, res: express.Response, next: express.NextFunction) => {
			// Error handler

			if (err instanceof Error) {
				const contents = err.stack ?? `${err.name}: ${err.message}`;
				this.logger.error(`Error on request ${req.id}. ${contents}`);
			}

			let status = 500;
			if (typeof err === "number") {
				status = err;
			}

			res.status(status).render("error.html", this.getErrorViewData(status, req));
		});

		app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
			// 404 handler
			res.status(404);

			// Respond with html page
			if (req.accepts("html")) {
				res.render("error.html", this.getErrorViewData(404, req));
				return;
			}

			// Respond with json
			if (req.accepts("json")) {
				res.json({ error: this.errorNames[404] });
				return;
			}

			// Default to plain-text
			res.type("txt").send(this.errorNames[404]);
		});

		this.gc();
		app.listen(listenPort, "0.0.0.0", () => {
			this.logger.info(`Server is listening on 0.0.0.0:${listenPort}.`);
		});
	}

	public getCharactersDb(realm: string): Connection {
		return this.charsDbs[realm.toLowerCase()];
	}

	public gc(): void {
		if (this.config.loadDbcs) {
			return;
		}

		setTimeout(() => {
			if (global.gc) {
				global.gc();
			}
		}, 500);
	}

	private wrapRoute(fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<any>) {
		// Adds error handling for promise-based controller methods
		return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
			try {
				await fn(req, res, next);
			} catch (e) {
				next(e);
			}
		};
	}

	private getErrorViewData(status: number, req: express.Request) {
		return {
			status,
			name: this.errorNames[status] || "An error occurred",
			description: this.errorDescriptions[status] || "",
			reqId: req.id,
		};
	}
}
