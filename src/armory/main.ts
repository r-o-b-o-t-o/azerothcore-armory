import * as path from "path";
import { Express } from "express";
import * as express from "express";
import { engine as handlebarsEngine } from "express-handlebars";

import { IndexController } from "./controllers/IndexController";

function main(): void {
	const app: Express = express();
	const listenPort = 48733;

	app.engine(".html", handlebarsEngine({
		"extname": "html",
		"partialsDir": path.join(process.cwd(), "static", "partials"),
		"layoutsDir": path.join(process.cwd(), "static"),
		"defaultLayout": "layout.html",
		"helpers": require("handlebars-helpers")(),
	}));
	app.set("view engine", "handlebars");
	app.set("views", path.join(process.cwd(), "static"));

	app.use("/js", express.static(`static/js`));
	app.use("/data/mo3", express.static(`data/mo3`));
	app.use("/data/meta", express.static(`data/meta`));
	app.use("/data/bone", express.static(`data/bone`));
	app.use("/data/textures", express.static(`data/textures`));
	app.use("/data/background.png", express.static(`data/background.png`));

	const indexController = new IndexController();
	app.get("/", indexController.index.bind(indexController));
	app.get("/character", indexController.character.bind(indexController));

	app.listen(listenPort, "0.0.0.0", () => {
		console.log(`Server is listening on 0.0.0.0:${listenPort}.`);
	});
}

main();
