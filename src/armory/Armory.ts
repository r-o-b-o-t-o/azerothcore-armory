import * as path from "path";
import { Express } from "express";
import * as express from "express";
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

	private charsDbs: { [key: string]: Connection };

	public constructor() {
		this.dbc = new DbcManager();
		this.characterCustomization = new CharacterCustomization();
		this.charsDbs = {};
	}

	public async start(): Promise<void> {
		const app: Express = express();
		const listenPort = 48733;

		console.log("Loading config...");
		this.config = await Config.load();
		console.log("Loading data files...");
		if (this.config.loadDbcs) {
			await this.dbc.loadAllFiles();
		}
		await this.characterCustomization.loadData();

		console.log("Connecting to databases...");
		this.worldDb = await createConnection(this.config.worldDatabase);
		for (const realm of this.config.realms) {
			this.charsDbs[realm.name.toLowerCase()] = await createConnection(realm.charactersDatabase);
		}

		console.log("Starting server...");
		app.locals.aowow = this.config.aowowUrl;
		app.engine(".html", handlebarsEngine({
			extname: "html",
			partialsDir: path.join(process.cwd(), "static", "partials"),
			layoutsDir: path.join(process.cwd(), "static"),
			defaultLayout: "layout.html",
			helpers: require("handlebars-helpers")(),
		}));
		app.set("view engine", "handlebars");
		app.set("views", path.join(process.cwd(), "static"));

		app.use("/js", express.static(`static/js`));
		app.use("/css", express.static(`static/css`));
		app.use("/img", express.static(`static/img`));
		app.use("/data/mo3", express.static(`data/mo3`));
		app.use("/data/meta", express.static(`data/meta`));
		app.use("/data/bone", express.static(`data/bone`));
		app.use("/data/textures", express.static(`data/textures`));
		app.use("/data/background.png", express.static(`data/background.png`));

		const indexController = new IndexController(this);
		app.get("/", indexController.index.bind(indexController));
		app.get("/search", indexController.search.bind(indexController));

		const charsController = new CharacterController(this);
		await charsController.load();
		app.get("/character/:realm/:name", charsController.character.bind(charsController));
		app.get("/character/:realm/:name/talents", charsController.talents.bind(charsController));
		app.get("/character/:realm/:name/achievements", charsController.achievements.bind(charsController));
		app.get("/character/:realm/:character/achievements/data", charsController.achievementsData.bind(charsController));

		this.gc();
		app.listen(listenPort, "0.0.0.0", () => {
			console.log(`Server is listening on 0.0.0.0:${listenPort}.`);
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
}
