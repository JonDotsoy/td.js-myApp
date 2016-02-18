/**
* This is the bootstrap app.
*/
import fs from "fs";
import path from "path";
import _ from "lodash";
import colors from "colors";
import {readdir, requireDir} from "./core/file";
import {listen, app, io} from "./core/server";
import Gulp from "gulp";
import dotenv from "dotenv";



let dirbase = path.resolve(__dirname, "..");
let tdoee = {};



/**
* Global value.
*/
global.tdoee = tdoee;
global.dirbase = dirbase;
global.env = (envName, defaultValue) => _.get(process.env, envName, defaultValue);
global.Config = (patch, defaultValue) => _.get(tdoee, `config.${patch}`, defaultValue);
global.Env = global.env;
global.parser_node_env = (NODE_ENV = env("NODE_ENV").toLowerCase()) => {
	switch (NODE_ENV) {
		case "production":
		case "product":
		case "pro":
			return "production";
		case "development":
		case "develop":
		case "dev":
		case "":
		default:
			return "development";
	}
};
global.envIsProduction = () => _.isEqual(parser_node_env(), "production");
global.envIsDevelopment = () => _.isEqual(parser_node_env(), "development");
global.envIsDevelop = global.envIsDevelopment;



/**
* Parse a path by this app
*/
global.parsePath = (...paths) => path.resolve(global.dirbase, ...paths);



/**
* Carga todo el contenido a un path de archivos a una variable global especificada en el patch.
*/
var globalVarByFiles = async function (pathname, globalpath) {
	let obtained = await requireDir(parsePath(pathname));
	let wrappedObtained = _(obtained);

	wrappedObtained.map(data => {
			_.set(global, `${globalpath}.${data.name}`, data.source);
			// return _({}).set(`${globalpath}.${data.name}`, data.source).value();
		}).run();

	return _.get(global, `${globalpath}`);
};


let globalizeServices = async function (services) {
	let wrappedServices = _(services)
	.filter(m => m.noGlobal !== true);

	// Globalize
	wrappedServices.map(m => _.set(global, m.name, m.service)).run();

	return wrappedServices.value();
}

let parserServices = async services => _(services)
	.map( ({
		service = null,
		priority = null,
		initialize = null,
		rename = null,
		noGlobal = null,
	} = {}, name) => ({
		name: _.isString(rename) ? rename : name,
		service,
		priority,
		initialize,
		noGlobal,
	}) )
	.filter( ({service}) => !_.isNull(service) )
	.value();


let initailizeServices = async services => _(services)
		.filter(service => _.has(service, "initialize") && _.isFunction(service.initialize))
		.sortBy('priority')
		.map( ({initialize, name}) => ({name, initialize:initialize()}) )
		.value()


let loadConfig = async () => await globalVarByFiles("config", "tdoee.config");

let loadServices = async function () {
	let servicesRequired = await globalVarByFiles("app/services", "tdoee.services");
	let services = await parserServices(servicesRequired);
	console.log(`[APP] ${_.size(services)} services loaded: ${_(services).map(({name}) => name).join(", ")}.`);


	let servicesInitialized = await initailizeServices(services);
	console.log(`[APP] ${_.size(servicesInitialized)} service has been initialized: ${_(servicesInitialized).map(({name}) => name).join(", ")}.`);


	let servicesGlobalized = await globalizeServices(services);
	console.log(`[APP] ${_.size(servicesGlobalized)} globalized services: ${_(servicesGlobalized).map(({name}) => name).join(", ")}.`);



	return services;
}


let loadGlobalConfig = async function () {
	let varGlobals = Config("app.globals", {});
	_(varGlobals)
	.map((g,i) => _.set(global, i, g))
	.run();
	return varGlobals;
}

let loadOpenServer = async function ({config = {}} = {}) {
	// let address = await listen(Config("http.port", 80), Config("http.host", "::"));
	let address = await listen(Config("http.port", 80), '::');

	console.log(`[APP] It has opened the server ${Url()}.`);

	return address;
}


let loadMiddlewares = async function () {
	let middlewareConfig = Config("http.middleware.order", []);

	let resourceMiddlewares = await requireDir(parsePath("app/middlewares"));
	let wrappedMiddlewares = _(resourceMiddlewares)
		.map(m => {
			m.order = _.indexOf(middlewareConfig, m.name);
			return m;
		})
		.filter(m => m.order != -1)
		.sortBy("order");
	let wrappedResourceMiddlewares = wrappedMiddlewares.map( m => m.source );

	// Filters
	let filterIfHas = (filterValue, collect) => _(collect).filter( (e,i) => i == filterValue ).value();
	let filterIfNotHas = (filterValue, collect) => _(collect).filter( (e,i) => (i != filterValue[0]) && (i != filterValue[1]) ).value();


	let middlewareManual = wrappedResourceMiddlewares.map( m => filterIfHas("manual", m) ).filter(m => m.length > 0);
	let middlewareSets = wrappedResourceMiddlewares.map( m => filterIfHas("set", m) ).filter(m => m.length > 0);
	let middlewareToUse = wrappedResourceMiddlewares.map( m => filterIfNotHas(["set", "manual"], m) ).filter(m => m.length > 0);

	// Initialize Manual use middlewares
	middlewareManual.map(m => _(m).map(e => e({app, io}) ).run()).run();

	// Asociate in app.set the middlewares sets
	middlewareSets.map(m => _(m).map(e => _(e).map((i,l) => app.set(l, i)).run()).run()).run();

	// Asociate in app.use the middlewares
	middlewareToUse.map(m => _(m).map(e => app.use(e)).run()).run();

	console.log(`[APP] ${wrappedMiddlewares.size()} middlewares loaded: ${wrappedMiddlewares.map(m => m.name).join(", ")}.`);

	return wrappedMiddlewares.value();
}

let loadResponses = async function () {
	let responses = await requireDir(parsePath("app/responses"));
	let wrappedResponses = _(responses);
	let wrappedResourceResponses = wrappedResponses.map(m => m.source);
	let responsesCreated = [];

	// Asociate Responses
	wrappedResourceResponses.map(response => {
		_(response).map( (c, i) => {
			responsesCreated.push(i);
			app.use( (req, res, next) => {
				_.set(res, i, c);
				next();
			} );
		} ).run();
	}).run();

	console.log(`[APP] ${_.size(responsesCreated)} responses associated: ${_(responsesCreated).join(", ")}.`);

	return responsesCreated;
}

let loadControllers = async function ({
	app = {},
	io = {},
	config = {},
	services = {},
} = {}) {
	let controllers = await requireDir(parsePath("app/controller"));
	let wrappedControllers = _(controllers);
	let controllersLoadArr = [];

	wrappedControllers.map(({
		name,
		source:ctrls,
	}, l) => {
		_(ctrls).map((ctrl, n) => {
			controllersLoadArr.push(`${name}/${n}`);
			ctrl.apply({
				app,
				io,
				config,
				services,
			});
		}).run();
	})
	.run();

	console.log(`[APP] ${_.size(controllersLoadArr)} controllers was loaded: ${_(controllersLoadArr).join(", ")}.`)
	return controllersLoadArr;
}


let loadModels = async function () {
	let models = await globalVarByFiles("app/models", "tdoee.models");
	// let wrappedModels = _(models).map(m => );

	// console.log(wrappedModels.value());
	_(models).map( (m, i) => {
		// console.log(i);
		_.set(global, i, m);
	} ).run();
	// console.log(models);

	// Call Relations
	_(models).map( (m, i) => {
		if (_.isFunction(m.relations)) {
			m.relations(models);
		}
	} ).run();

	// Call finish load
	_(models).map( (m, i) => {
		if (_.isFunction(m.endLoad)) {
			m.endLoad(models);
		}
	} ).run();

	return [];
}

let loadTasks = async function () {
	require(__dirname + "/../Gulpfile.babel");

	let TasksListStart = Config("gulp.tasks", [
		"build:watch",
		"sass:watch",
	]);

	Gulp.start(...TasksListStart);

	console.log(`[APP] [Gulp] Load tasks: ${TasksListStart.map(e => `[${e}]`).join(", ")}.`);
}

let loadEnvFiles = async function () {
	var e = path.resolve("./.env");
	if (fs.existsSync(e)) {
		return dotenv.config();
	} else {
		return {};
	}
}

let bootstrap = async function () {
	let config = null, tasks = null, services = null, models = null, globalVar = null, address = null, middlewares = null, responsesCreated = null, controllersLoad = null;

	try {
		// Load Env Files
		await loadEnvFiles();
	} catch (ex) { ex.message = `[Bootstrap] [file envs] ${ex.message}`; throw ex; }

	try {
		// Load Config
		config = await loadConfig();
	} catch (ex) { ex.message = `[Bootstrap] [config] ${ex.message}`; throw ex; }

	if (envIsDevelop()) {
		try {
			// Load Tasks
			tasks = loadTasks();
		} catch (ex) { ex.message = `[Bootstrap] [tasks] ${ex.message}`; throw ex; }
	}

	try {
		// Load Services
		services = await loadServices();
	} catch (ex) { ex.message = `[Bootstrap] [services] ${ex.message}`; throw ex; }

	try {
		// Load Models
		models = await loadModels();
	} catch (ex) { ex.message = `[Bootstrap] [models] ${ex.message}`; throw ex; }

	try {
		// Globalize By Configs
		globalVar = await loadGlobalConfig();
	} catch (ex) { ex.message = `[Bootstrap] [globalVar] ${ex.message}`; throw ex; }

	try {
		// Open server
		address = await loadOpenServer({config});
	} catch (ex) { ex.message = `[Bootstrap] [address] ${ex.message}`; throw ex; }

	try {
		// Load Middlewares
		middlewares = await loadMiddlewares();
	} catch (ex) { ex.message = `[Bootstrap] [middlewares] ${ex.message}`; throw ex; }

	try {
		// Load Responses
		responsesCreated = await loadResponses();
	} catch (ex) { ex.message = `[Bootstrap] [responsesCreated] ${ex.message}`; throw ex; }

	try {
		// Load controllers
		controllersLoad = await loadControllers({
			app,
			io,
			config,
			services,
		});
	} catch (ex) { ex.message = `[Bootstrap] [controllersLoad] ${ex.message}`; throw ex; }
}



bootstrap()
.then(ok => {
	console.log("[APP] Is Ready.".green);
}, err => {
	console.log(`[APP] Error: ${err.message}`.red);
	console.log(err.stack);
	process.exit(1);
});

