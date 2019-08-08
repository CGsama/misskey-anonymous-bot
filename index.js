var stdin = process.openStdin();
var fs = require('fs');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(':memory:');
var request = require('request-json');
var crypto = require('crypto');
var cryptoRandomString = require('crypto-random-string');
var readline = require('readline-sync');

var apikey = "";
var myid = "";
var instanceURL = "";
var msky = null;
var secretSaltKey = "";
var secretHashKey = "";
var count = 0;
var onLoad = false;
var config = null;

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
	console.log(msg);
	count++;
	data = {text: msg.text + signMsg(msg), visibility: "public", localOnly: false, geo: null, i: apikey};
	if(msg.fileid){
		data.fileIds = [msg.fileid];
	}
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

function pulling(){
	setTimeout(function(){
		console.log("Checking!");
		pullAllChats();
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

db = new sqlite3.Database('gcnmb.db');

try{
	let rawconfig = fs.readFileSync('config.json');
}
catch(e){
	createDB();
	let obj = {};
	obj.apikey = readline.question("apikey?(e.g. 9p4pC6kQY20WFlKB) ");
	obj.myid = readline.question("user id?(e.g. 7w8s0v4j3q) ");
	obj.instanceURL = readline.question("instance url?(e.g. misskey.gothloli.club) ");
	obj.secretSaltKey = cryptoRandomString({length: 16, type: 'hex'});
	obj.secretHashKey = cryptoRandomString({length: 16, type: 'hex'});
	fs.writeFileSync('config.json', JSON.stringify(obj));
}
finally{
	config = JSON.parse(fs.readFileSync('config.json'));
	apikey = config.apikey;
	myid = config.myid;
	instanceURL = config.instanceURL;
	secretSaltKey = config.secretSaltKey;
	secretHashKey = config.secretHashKey;
	msky = request.createClient('https://' + instanceURL + '/')
	pulling();
	counting();
}
