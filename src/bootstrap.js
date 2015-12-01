const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");

//Global variables
var windowMenuIds = [];
var preferences = null;
var windowListener = null;

let Addon = {
	enabled: true,
	deniedContentTypes: {},

	initialize: function(){
		let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
		registrar.registerFactory(this.classID,this.classDescription,this.contractID,this);

		let categoryManager = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
		for each(let category in this.xpcom_categories){
			categoryManager.addCategoryEntry(category,this.contractID,this.contractID,false,true);
		}

		//Initialize settings from storage
		this.enabled = preferences.getBoolPref("enabled");
		this.deniedContentTypes[Ci.nsIContentPolicy.TYPE_IMAGE]          = preferences.getBoolPref("type.image");
		this.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SCRIPT]         = preferences.getBoolPref("type.script");
		this.deniedContentTypes[Ci.nsIContentPolicy.TYPE_FONT]           = preferences.getBoolPref("type.font");
		this.deniedContentTypes[Ci.nsIContentPolicy.TYPE_MEDIA]          = preferences.getBoolPref("type.media");
		this.deniedContentTypes[Ci.nsIContentPolicy.TYPE_OBJECT]         = preferences.getBoolPref("type.object");
		this.deniedContentTypes[Ci.nsIContentPolicy.TYPE_STYLESHEET]     = preferences.getBoolPref("type.stylesheet");
		this.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SUBDOCUMENT]    = preferences.getBoolPref("type.subdocument");
		this.deniedContentTypes[Ci.nsIContentPolicy.TYPE_XMLHTTPREQUEST] = preferences.getBoolPref("type.xmlhttprequest");
	},

	finalize: function(){
		let categoryManager = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
		for each(let category in this.xpcom_categories){
			categoryManager.deleteCategoryEntry(category,this.contractID,false);
		}

		//May need to run asynchronously (bug 753687)
		Services.tm.currentThread.dispatch(function(){
			let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
			registrar.unregisterFactory(this.classID,this);
		}.bind(this),Ci.nsIEventTarget.DISPATCH_NORMAL);
	},

	//////////////////////////////////////////////////
	//nsIClassInfo interface implementation
	classDescription: "Filetype Content Blocker",
	classID: Components.ID("{2bd9b938-97b2-11e5-947f-f6771d5d46b0}"),
	contractID: "@lolirofle/filetypecontentblocker-policy;1",
	xpcom_categories: ["content-policy"],

	//////////////////////////////////////////////////
	//nsIContentPolicy interface implementation
	shouldLoad: function(contentType,contentLocation,requestOrigin,node,mimeTypeGuess,extra){
		if(this.enabled && typeof this.deniedContentTypes[contentType] !== 'undefined' && this.deniedContentTypes[contentType]){
			return Ci.nsIContentPolicy.REJECT;
		}
		return Ci.nsIContentPolicy.ACCEPT;
	},

	shouldProcess: function(contentType,contentLocation,requestOrigin,node,mimeTypeGuess,extra){
		return Ci.nsIContentPolicy.ACCEPT;
	},

	//////////////////////////////////////////////////
	//nsIFactory interface implementation
	createInstance: function(outer,iid){
		if(outer)
			throw Cr.NS_ERROR_NO_AGGREGATION;
		return this.QueryInterface(iid);
	},

	//////////////////////////////////////////////////
	//nsISupports interface implementation
	QueryInterface: XPCOMUtils.generateQI([Ci.nsIContentPolicy,Ci.nsIFactory])

};

//Bootstrap entry point
function install(bootstrap_data,reason){
	//Define preferences if undefined
	if(!preferences)
		preferences = Components.classes["@mozilla.org/preferences-service;1"]
			.getService(Components.interfaces.nsIPrefService)
			.getBranch("lolirofle.filetypecontentblocker.");

	//First time initialization
	if(reason === ADDON_INSTALL){
		//Insert default settings
		preferences.setBoolPref("enabled"            ,false);
		preferences.setBoolPref("type.image"         ,true);
		preferences.setBoolPref("type.script"        ,false);
		preferences.setBoolPref("type.font"          ,false);
		preferences.setBoolPref("type.media"         ,false);
		preferences.setBoolPref("type.object"        ,false);
		preferences.setBoolPref("type.stylesheet"    ,false);
		preferences.setBoolPref("type.subdocument"   ,false);
		preferences.setBoolPref("type.xmlhttprequest",false);
	}
}

//Bootstrap entry point
function uninstall(bootstrap_data,reason){
	if(reason === ADDON_UNINSTALL){
		//Define preferences if undefined
		if(!preferences)
			preferences = Components.classes["@mozilla.org/preferences-service;1"]
				.getService(Components.interfaces.nsIPrefService)
				.getBranch("lolirofle.filetypecontentblocker.");

		//Remove default settings
		preferences.deleteBranch("");
	}
}

//Bootstrap entry point
function startup(bootstrap_data,reason){
	//Define preferences if undefined
	if(!preferences)
		preferences = Components.classes["@mozilla.org/preferences-service;1"]
			.getService(Components.interfaces.nsIPrefService)
			.getBranch("lolirofle.filetypecontentblocker.");

	Addon.initialize();

	//Initialize for existing windows
	let windows = Services.wm.getEnumerator("navigator:browser");
	while(windows.hasMoreElements()){
		initializeWindow(windows.getNext().QueryInterface(Ci.nsIDOMWindow),bootstrap_data);
	}

	//Initialization for new windows
	Services.wm.addListener(windowListener = {
		onOpenWindow: function(window){
			//Wait for the window to finish loading
			window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow).addEventListener("load",function(){
				this.removeEventListener("load",arguments.callee,false);
				initializeWindow(this,bootstrap_data);
			},false);
		},

		onCloseWindow: function(window){},

		onWindowTitleChange: function(window,title){}
	});
}

//Bootstrap entry point
function shutdown(bootstrap_data,reason){
	//Unnessacary to clean up UI changes when the application is shutting down
	if(reason === APP_SHUTDOWN){
		return;
	}

	//Stop initialization for new windows
	if(windowListener){
		Services.wm.removeListener(windowListener);
	}

	//Finalize for existing windows
	let windows = Services.wm.getEnumerator("navigator:browser");
	while(windows.hasMoreElements()){
		finalizeWindow(windows.getNext().QueryInterface(Ci.nsIDOMWindow));
	}

	Addon.finalize();
}

function initializeWindow(window,bootstrap_data){
	//If window is undefined
	if(!window)
		return;

	//If Firefox for Android
	if(Services.appinfo.ID === "{aa3c5121-dab2-40e2-81ca-7ea25febc110}"){
		//Add menu item
		windowMenuIds[0] = window.NativeWindow.menu.add({
			name: "Block content",
			icon: bootstrap_data.resourceURI.spec + "icon.png"
		});

		//Add menu subitems
		windowMenuIds[1] = window.NativeWindow.menu.add({
			name: "Images",
			parent: windowMenuIds[0],
			callback: function(){
				Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_IMAGE] = !Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_IMAGE];
				preferences.setBoolPref("type.image",Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_IMAGE]);
				window.NativeWindow.menu.update(windowMenuIds[1],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_IMAGE]});
			},
			checkable: true
		});
		window.NativeWindow.menu.update(windowMenuIds[1],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_IMAGE]});

		windowMenuIds[2] = window.NativeWindow.menu.add({
			name: "Scripts",
			parent: windowMenuIds[0],
			callback: function(){
				Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SCRIPT] = !Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SCRIPT];
				preferences.setBoolPref("type.script",Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SCRIPT]);
				window.NativeWindow.menu.update(windowMenuIds[2],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SCRIPT]});
			},
			checkable: true
		});
		window.NativeWindow.menu.update(windowMenuIds[2],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SCRIPT]});

		windowMenuIds[3] = window.NativeWindow.menu.add({
			name: "Fonts",
			parent: windowMenuIds[0],
			callback: function(){
				Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_FONT] = !Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_FONT];
				preferences.setBoolPref("type.font",Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_FONT]);
				window.NativeWindow.menu.update(windowMenuIds[3],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_FONT]});
			},
			checkable: true
		});
		window.NativeWindow.menu.update(windowMenuIds[3],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_FONT]});

		windowMenuIds[4] = window.NativeWindow.menu.add({
			name: "Media (Video/Audio)",
			parent: windowMenuIds[0],
			callback: function(){
				Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_MEDIA] = !Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_MEDIA];
				preferences.setBoolPref("type.media",Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_MEDIA]);
				window.NativeWindow.menu.update(windowMenuIds[4],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_MEDIA]});
			},
			checkable: true
		});
		window.NativeWindow.menu.update(windowMenuIds[4],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_MEDIA]});

		windowMenuIds[5] = window.NativeWindow.menu.add({
			name: "Objects (Plugin-handled)",
			parent: windowMenuIds[0],
			callback: function(){
				Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_OBJECT] = !Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_OBJECT];
				preferences.setBoolPref("type.object",Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_OBJECT]);
				window.NativeWindow.menu.update(windowMenuIds[5],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_OBJECT]});
			},
			checkable: true
		});
		window.NativeWindow.menu.update(windowMenuIds[5],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_OBJECT]});

		windowMenuIds[6] = window.NativeWindow.menu.add({
			name: "Stylesheets",
			parent: windowMenuIds[0],
			callback: function(){
				Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_STYLESHEET] = !Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_STYLESHEET];
				preferences.setBoolPref("type.stylesheet",Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_STYLESHEET]);
				window.NativeWindow.menu.update(windowMenuIds[6],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_STYLESHEET]});
			},
			checkable: true
		});
		window.NativeWindow.menu.update(windowMenuIds[6],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_STYLESHEET]});

		windowMenuIds[7] = window.NativeWindow.menu.add({
			name: "Subdocuments (Frames)",
			parent: windowMenuIds[0],
			callback: function(){
				Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SUBDOCUMENT] = !Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SUBDOCUMENT];
				preferences.setBoolPref("type.subdocument",Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SUBDOCUMENT]);
				window.NativeWindow.menu.update(windowMenuIds[7],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SUBDOCUMENT]});
			},
			checkable: true
		});
		window.NativeWindow.menu.update(windowMenuIds[7],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_SUBDOCUMENT]});

		windowMenuIds[8] = window.NativeWindow.menu.add({
			name: "In-page Request",
			parent: windowMenuIds[0],
			callback: function(){
				Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_XMLHTTPREQUEST] = !Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_XMLHTTPREQUEST];
				preferences.setBoolPref("type.xmlhttprequest",Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_XMLHTTPREQUEST]);
				window.NativeWindow.menu.update(windowMenuIds[8],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_XMLHTTPREQUEST]});
			},
			checkable: true
		});
		window.NativeWindow.menu.update(windowMenuIds[8],{checked: Addon.deniedContentTypes[Ci.nsIContentPolicy.TYPE_XMLHTTPREQUEST]});

		windowMenuIds[9] = window.NativeWindow.menu.add({
			name: "Global toggle",
			parent: windowMenuIds[0],
			callback: function(){
				Addon.enabled = !Addon.enabled;
				preferences.setBoolPref("enabled",Addon.enabled);
				window.NativeWindow.menu.update(windowMenuIds[9],{checked: Addon.enabled});
			},
			checkable: true
		});
		window.NativeWindow.menu.update(windowMenuIds[9],{checked: Addon.enabled});
	}
}

function finalizeWindow(window){
	//If window is undefined
	if(!window)
		return;

	//If Firefox for Android
	if(Services.appinfo.ID === "{aa3c5121-dab2-40e2-81ca-7ea25febc110}"){
		//Remove menu item and menu subitems
		for(var i=0; i<windowMenuIds.length; i++){
			window.NativeWindow.menu.remove(windowMenuIds[i]);
		};
	}
}
