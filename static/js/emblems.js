function waitForEmblemImages($emblem) {
	return Promise.all($emblem.find(".images img").map((idx, img) => {
		return new Promise((res, rej) => {
			if (img.complete) {
				res();
			} else {
				img.addEventListener("load", res);
				img.addEventListener("error", rej);
			}
		});
	}));
}

function createGuildEmblem(emblem, el) {
	const $emblem = $(el);
	const canvas = $emblem.find("canvas")[0];
	const ctx = canvas.getContext("2d");

	const imgUrl = (type, section, value, value2) => `${handlebarsData.websiteRoot}/img/guild-emblems/${type}_${value}${value2 ? ("_" + value2) : ""}_T${section}_U.PNG`;

	const $images = $("<div>").addClass("images").appendTo($emblem);
	const bgUpper = $("<img>").attr("src", imgUrl("Background", "U", emblem.background)).appendTo($images)[0];
	const bgLower = $("<img>").attr("src", imgUrl("Background", "L", emblem.background)).appendTo($images)[0];
	const iconUpper = $("<img>").attr("src", imgUrl("Emblem", "U", emblem.icon, emblem.iconColor)).appendTo($images)[0];
	const iconLower = $("<img>").attr("src", imgUrl("Emblem", "L", emblem.icon, emblem.iconColor)).appendTo($images)[0];
	const borderUpper = $("<img>").attr("src", imgUrl("Border", "U", emblem.border, emblem.borderColor)).appendTo($images)[0];
	const borderLower = $("<img>").attr("src", imgUrl("Border", "L", emblem.border, emblem.borderColor)).appendTo($images)[0];

	const drawEmblemLayer = (ctx, layer) => {
		const [upper, lower] = layer;

		const w = upper.width / 2;
		const uh = upper.height;
		const lh = lower.height;

		ctx.drawImage(upper, 0, 0, w, uh, w, 0, w, uh);
		ctx.drawImage(lower, 0, 0, w, lh, w, upper.height, w, lh);
		ctx.save();
		ctx.scale(-1, 1);
		ctx.drawImage(upper, 0, 0, w, uh, 0, 0, -w, uh);
		ctx.drawImage(lower, 0, 0, w, lh, 0, upper.height, -w, lh);
		ctx.restore();
	};

	waitForEmblemImages($emblem).then(() => {
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(26, 0);
		ctx.lineTo(64, 28);
		ctx.lineTo(102, 0);
		ctx.lineTo(128, 0);
		ctx.lineTo(128, 96);
		ctx.lineTo(0, 96);
		ctx.closePath();
		ctx.clip();
		drawEmblemLayer(ctx, [bgUpper, bgLower]);
		drawEmblemLayer(ctx, [iconUpper, iconLower]);
		drawEmblemLayer(ctx, [borderUpper, borderLower]);
	});
}

function createArenaEmblem(teamSize, emblem, el) {
	const $emblem = $(el);
	const canvas = $emblem.find("canvas")[0];
	const ctx = canvas.getContext("2d");

	const imgUrl = (teamSize, type, value) => `${handlebarsData.websiteRoot}/img/arena-banners/PVP-Banner${teamSize ? ("-" + teamSize) : ""}${type ? ("-" + type) : ""}${value ? ("-" + value) : ""}.PNG`;

	const $images = $("<div>").addClass("images").appendTo($emblem);
	const banner = $("<img>").attr("src", imgUrl(teamSize)).appendTo($images)[0];
	const bannerCrop = $("<img>").attr("src", imgUrl(teamSize, "Crop")).appendTo($images)[0];
	const border = $("<img>").attr("src", imgUrl(teamSize, "Border", emblem.border)).appendTo($images)[0];
	const icon = $("<img>").attr("src", imgUrl(undefined, "Emblem", emblem.icon)).appendTo($images)[0];

	const colorToHex = (color) => "#" + parseInt(color).toString(16).substring(2);

	waitForEmblemImages($emblem).then(() => {
		const srcH = 224;
		const h = 128;
		const w = (banner.width / srcH) * h;
		const iconW = icon.width * 0.35;
		const iconH = icon.height * 0.35;
		ctx.drawImage(banner, 0, 0, banner.width, srcH, 0, 0, w, h);
		ctx.drawImage(tintImage(bannerCrop, colorToHex(emblem.background)), 0, 0, banner.width, srcH, 0, 0, w, h);
		ctx.drawImage(tintImage(border, colorToHex(emblem.borderColor)), 0, 0, border.width, srcH, 0, 0, w, h);
		ctx.drawImage(tintImage(icon, colorToHex(emblem.iconColor)), w * 0.385 - iconW / 2, h * 0.325 - iconH / 2, iconW, iconH);
	});
}

const tintCanvas = document.createElement("canvas");
const tintContext = tintCanvas.getContext("2d");
function tintImage(image, color, opacity = 1.0) {
	const ctx = tintContext;

	ctx.canvas.width = image.width;
	ctx.canvas.height = image.height;

	// First draw the image to the buffer
	ctx.drawImage(image, 0, 0);

	// Multiply with a rectangle of the specified color
	ctx.fillStyle = color;
	ctx.globalCompositeOperation = "multiply";
	ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

	// Finally, fix masking issues and globalAlpha
	ctx.globalAlpha = opacity;
	ctx.globalCompositeOperation = "destination-in";
	ctx.drawImage(image, 0, 0);

	return ctx.canvas;
}
