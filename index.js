var fs = require('fs');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(':memory:');
var request = require('request-json');
var crypto = require('crypto');
var cryptoRandomString = require('crypto-random-string');
var readline = require('readline-sync');
var configFile = 'config.json';

var apikey = "";
var myid = "";
var instanceURL = "";
var msky = null;
var secretSaltKey = "";
var secretHashKey = "";
var visibility = ""
var count = 0;
var onLoad = false;
var config = null;
var mock = false;

function createDB(){
	db.run("CREATE TABLE IF NOT EXISTS gcnmb (msgid TEXT NOT NULL UNIQUE)");
}

function addMsg(msg){
	let i = db.prepare("INSERT OR REPLACE INTO gcnmb VALUES (?)");
	i.run([msg.id]);
	i.finalize();
}

function printDB(){
	let s = db.prepare("SELECT * FROM gcnmb");
	s.each([], function(err, row){
		console.log(row);
	});
}

function doExist(msgid, cb){
	var s = db.prepare("SELECT * FROM gcnmb WHERE msgid=?");
	s.get(msgid, function(err, row){
		cb(!row == false);
	})
}

function sendPost(msg){
	data = {text: msg.text + signMsg(msg), visibility: visibility, localOnly: false, geo: null, i: apikey};
	console.log(data);
	if(msg.fileid){
		data.fileIds = [msg.fileid];
	}
	console.log(msg);
	if(mock){
		return;
	}
	count++;
	msky.post('api/notes/create', data, function(err, res, body) {
		if(err){
			console.log(err);
		}
		count--;
	});
}

function pullAllChats(){
	data = {group: false, i: apikey};
	msky.post('api/messaging/history', data, function(err, res, body) {
		if(err){
			console.log(err);
		}
		try{
			if(body){
				body.forEach(function(item){
					let msg = msg2obj(item);
					doExist(msg.id, function(exist){
						console.log("history: " + msg.id + (exist ? " exist" : " not exist"));
						if(!exist){
							pullConversation(msg);
						}
					})
				});
			}
		}catch(e){
			console.log(e);
		}
	});
}

function msg2obj(msg){
	let fromMyself = msg.userId == myid;
	let data = {
		id: msg.id,
		time: msg.createdAt,
		userid: fromMyself ? msg.recipientId : msg.userId,
		username: fromMyself ? "" : (msg.user.username + "@" + (msg.user.host == null ? instanceURL : msg.user.host)),
		nickname: fromMyself ? "" : msg.user.name,
		text: fromMyself ? "" : msg.text,
		file: fromMyself ? null : (msg.file ? msg.file.url : null),
		fileid: null
	}
	return data;
}

function pullConversation(msg){
	count++;
	data = {userId: msg.userid, limit: 11, i: apikey};
	msky.post('api/messaging/messages', data, function(err, res, body) {
		count--;
		body.reverse();
		console.log("pull conversation for: " + msg.userid);
		body.forEach(function(item){
			let msg = msg2obj(item);
			doExist(msg.id, function(exist){
				console.log(msg.id + (exist ? " exist" : " not exist"));
				if(!exist){
					addMsg(msg);
					if(msg.text != "" || msg.file){
						uploadFromUrl(msg, sendPost);
					}
				}
			})
		});
	});
}

function signMsg(msg){
	let salt = cryptoRandomString({length: 16, type: 'hex'});
	let saltHash = crypto.createHash('sha256').update(salt + secretSaltKey).digest('hex');
	let currHashKey = crypto.createHash('sha256').update(salt + secretHashKey).digest('hex');
	let authorHash = crypto.createHash('sha256').update(currHashKey + msg.username + currHashKey).digest('hex');
	let textHash = crypto.createHash('sha256').update(currHashKey + msg.text + currHashKey).digest('hex');
	return " (gcnmb:" + salt + ":" + authorHash.substring(0, 16) + ":" + textHash.substring(0, 16) + ")";
}

function uploadFromUrl(msg, cb){
	if(!msg.file){
		cb(msg);
	}else{
		count++;
		data = {url: msg.file, i: apikey};
		msky.post('api/drive/files/upload-from-url', data, function(err, res, body) {
			count--;
			msg.fileid = body.id;
			cb(msg);
		});
	}
}

function getMyId(cb, ecb){
	temp = request.createClient('https://' + instanceURL + '/')
	data = {i: apikey};
	count++;
	temp.post('api/i', data, function(err, res, body) {
		count--;
		if(body && body.id){
			myid = body.id;
			cb();
		}else{
			console.log(err);
			console.log(body);
			ecb();
		}
	});
}

function pulling(){
	setTimeout(function(){
		console.log("Checking!");
		getMyId(pullAllChats, function(){});
	},5000);
	setTimeout(pulling,60000);
}

function counting(){
	if(onLoad){
		if(count == 0){
			onLoad = false;
			console.log("off");
		}
	}
	if(!onLoad){
		if(count != 0){
			onLoad = true;
			console.log("on");
		}
	}
	setTimeout(counting,100);
}

function run(){
	config = JSON.parse(fs.readFileSync(configFile));
	apikey = config.apikey;
	instanceURL = config.instanceURL;
	visibility = config.visibility;
	secretSaltKey = config.secretSaltKey;
	secretHashKey = config.secretHashKey;
	msky = request.createClient('https://' + instanceURL + '/')
	pulling();
	counting();
}


db = new sqlite3.Database('gcnmb.db');

let rawconfig = fs.readFile('config.json', function(err, data){
	if(err){
		mock = readline.question("Dry run? Enter anything if not.") == "";
		if(mock){
			db = new sqlite3.Database(':memory:');
			configFile = 'mock-config.json';
		}
		createDB();
		let obj = {};
		obj.instanceURL = readline.question("instance url?(e.g. misskey.gothloli.club) ");
		obj.instanceURL = obj.instanceURL != "" ? obj.instanceURL : "misskey.gothloli.club"
		obj.apikey = readline.question("apikey?(e.g. 9p4pC6kQY20WFlKB) ");
		let v = readline.question("visibility?(1:home, 2:followers, other:public) ");
		switch(v){
			case "1":
				obj.visibility = "home";
				console.log("Visible for home");
				break;
			case "2":
				obj.visibility = "followers";
				console.log("Visible for followers");
				break;
			default:
				obj.visibility = "public";
				console.log("Visible for public");
				break;
		}
		obj.secretSaltKey = cryptoRandomString({length: 16, type: 'hex'});
		obj.secretHashKey = cryptoRandomString({length: 16, type: 'hex'});
		instanceURL = obj.instanceURL;
		apikey = obj.apikey;
		getMyId(function(){
			console.log("Credential works!");
			fs.writeFileSync(configFile, JSON.stringify(obj));
			run();
		}, function(){
			console.log("Credential or host name wrong!");
		});
	}else{
		run();
	}
});
