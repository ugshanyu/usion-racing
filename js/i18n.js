const STRINGS = {
	en: {
		waitingRoom: 'Waiting room',
		waitingSub: 'Race starts when everyone is ready',
		ready: 'Ready',
		notReady: 'Tap when ready',
		startRace: 'Start race',
		waitingHost: 'Waiting for the host to start…',
		needPlayers: 'Waiting for players…',
		invite: 'Invite friends',
		playBots: 'Play with bots',
		raceLength: 'Race length',
		laps: 'laps',
		host: 'Host',
		you: 'You',
		lap: 'LAP',
		best: 'BEST',
		last: 'LAST',
		go: 'GO!',
		finished: 'Finished!',
		results: 'Race results',
		dnf: 'DNF',
		raceAgain: 'Race again',
		waitingRematch: 'Waiting for the host…',
		friends: 'Friends',
		global: 'Global',
		bestLap: 'Best lap',
		yourTime: 'Your time',
		noScores: 'No records yet — set one!',
		reconnecting: 'Reconnecting…',
		leftRace: 'left the race',
		spectating: 'Race in progress — the next one starts soon',
		botTag: 'BOT',
		positions: [ '1st', '2nd', '3rd', '4th' ],
		phrases: [ 'Good luck!', 'Nice drift!', 'Too slow! 😎', 'Catch me if you can!', 'Ouch!', 'GG', 'Rematch?', '😂' ],
		typeOwn: 'Type your own…',
		send: 'Send',
	},
	mn: {
		waitingRoom: 'Хүлээлгийн өрөө',
		waitingSub: 'Бүгд бэлэн болмогц уралдаан эхэлнэ',
		ready: 'Бэлэн',
		notReady: 'Бэлэн болбол дарна уу',
		startRace: 'Уралдаан эхлүүлэх',
		waitingHost: 'Эзэн эхлүүлэхийг хүлээж байна…',
		needPlayers: 'Тоглогчдыг хүлээж байна…',
		invite: 'Найзаа урих',
		playBots: 'Ботуудтай тоглох',
		raceLength: 'Уралдааны тойрог',
		laps: 'тойрог',
		host: 'Эзэн',
		you: 'Та',
		lap: 'ТОЙРОГ',
		best: 'ШИЛДЭГ',
		last: 'СҮҮЛИЙН',
		go: 'ЗА!',
		finished: 'Бариа!',
		results: 'Уралдааны үр дүн',
		dnf: 'DNF',
		raceAgain: 'Дахин уралдах',
		waitingRematch: 'Эзнийг хүлээж байна…',
		friends: 'Найзууд',
		global: 'Дэлхий',
		bestLap: 'Шилдэг тойрог',
		yourTime: 'Таны хугацаа',
		noScores: 'Одоогоор амжилт алга — эхлүүлээрэй!',
		reconnecting: 'Дахин холбогдож байна…',
		leftRace: 'уралдаанаас гарлаа',
		spectating: 'Уралдаан явагдаж байна — удахгүй дараагийнх эхэлнэ',
		botTag: 'БОТ',
		positions: [ '1-р', '2-р', '3-р', '4-р' ],
		phrases: [ 'Амжилт!', 'Гоё дрифт!', 'Удаан байна аа 😎', 'Гүйцээд үз!', 'Өө халтар!', 'GG', 'Дахиад?', '😂' ],
		typeOwn: 'Өөрөө бичих…',
		send: 'Илгээх',
	},
};

let current = STRINGS.en;

export function setLanguage( lang ) {

	current = STRINGS[ ( lang || 'en' ).slice( 0, 2 ) ] || STRINGS.en;

}

export function t( key ) {

	return current[ key ] !== undefined ? current[ key ] : ( STRINGS.en[ key ] !== undefined ? STRINGS.en[ key ] : key );

}
