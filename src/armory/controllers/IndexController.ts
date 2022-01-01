import * as express from "express";

export class IndexController {
	public async index(req: express.Request, res: express.Response): Promise<void> {
		res.render("index.html", {
			"title": "Armory",
		});
	}

	public async character(req: express.Request, res: express.Response): Promise<void> {
		res.render("character.html", {
			"title": "Armory",
		});
	}
}
