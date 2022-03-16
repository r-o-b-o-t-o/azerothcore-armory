window.parent.postMessage({
	url: window.location.pathname.replace(handlebarsData.websiteRoot, ""),
}, "*");
