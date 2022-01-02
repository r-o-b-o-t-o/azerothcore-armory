import * as express from "express";

import { Armory } from "../Armory";

export class IndexController {
	private armory: Armory;

	public constructor(armory: Armory) {
		this.armory = armory;
	}

	public async index(req: express.Request, res: express.Response): Promise<void> {
		res.render("index.html", {
			title: "Armory",
		});
	}
}
