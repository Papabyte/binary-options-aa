// uses `aa-testkit` testing framework for AA tests. Docs can be found here `https://github.com/valyakin/aa-testkit`
// `mocha` standard functions and `expect` from `chai` are available globally
// `Testkit`, `Network`, `Nodes` and `Utils` from `aa-testkit` are available globally too
const path = require('path')
const { expect } = require('chai')
const CONTRACT_BASE_AA = '../option-contract-base.aa'
const HELPER_AA = '../helper.aa'
const objectHash = require('ocore/object_hash.js')

const byte_to_asset_fees = 5000

describe('Check AA', function () {
	this.timeout(120000)

	before(async () => {
		this.network = await Network.create()
			.with.agent({ helper: path.join(__dirname, HELPER_AA) })
			.with.agent({ contract_base: path.join(__dirname, CONTRACT_BASE_AA) })
			.with.asset({ random_asset: {} })
			.with.explorer()
			.with.wallet({ alice: 1e8 })
			.with.wallet({ bob: 1e9 })
			.with.wallet({ oracle: 1e6 })

			.run()

		const { unit, error } = await this.network.deployer.sendMulti({
			asset: this.network.asset.random_asset,
			asset_outputs: [{
				address: await this.network.wallet.alice.getAddress(),
				amount: 50e9
			}]
		}
		)

		console.log('helper: ' + this.network.agent.helper)
		console.log('contract base aa:' + this.network.agent.contract_base)
	})

	it('Deploy AA with greater-than comparaison', async () => {
		this.gt_feed_name = 'EUR_USD'
		this.gt_value = 1.2
		this.gt_operator = '>'
		this.gt_days_for_expiration = 10
		const time_now = new Date()
		this.gt_expiry_date = new Date(time_now.getTime() + this.gt_days_for_expiration * 24 * 3600 * 1000).toISOString().slice(0, -14)

		const { address, unit, error } = await this.network.deployer.deployAgent(`[
			"autonomous agent",
			{
					"base_aa": "${this.network.agent.contract_base}",
					"params": {
							"oracle_address": "${await this.network.wallet.oracle.getAddress()}",
							"feed_name":"${this.gt_feed_name}",
							"comparison":"${this.gt_operator}",
							"feed_value":"${this.gt_value}",
							"expiry_date": "${this.gt_expiry_date}"
					}
			}
		]`)
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		await this.network.witnessUntilStable(unit)

		this.gt_aa = address
	}).timeout(10000)

	it('Alice converts bytes to greater-than asset', async () => {
		this.gt_asset_amount_alice = 196333
		const { unit, error } = await this.network.wallet.alice.sendBytes({
			toAddress: this.gt_aa,
			amount: this.gt_asset_amount_alice
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined

		await this.network.witnessUntilStable(response.response_unit)
		const { vars } = await this.network.deployer.readAAStateVars(this.gt_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit

		this.gt_yes_asset = vars.yes_asset
		this.gt_no_asset = vars.no_asset

		this.gt_asset_amount_alice -= byte_to_asset_fees
		var alice_balances = await this.network.wallet.alice.getBalance()
		expect(alice_balances[this.gt_yes_asset].stable).to.be.equal(this.gt_asset_amount_alice)
		expect(alice_balances[this.gt_no_asset].stable).to.be.equal(this.gt_asset_amount_alice)
	}).timeout(60000)

	it('Bob converts bytes to greater-than asset', async () => {
		this.gt_asset_amount_bob = 3333304
		const { unit, error } = await this.network.wallet.bob.sendBytes({
			toAddress: this.gt_aa,
			amount: this.gt_asset_amount_bob
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined

		await this.network.witnessUntilStable(response.response_unit)
		const { vars } = await this.network.deployer.readAAStateVars(this.gt_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit

		this.gt_yes_asset = vars.yes_asset
		this.gt_no_asset = vars.no_asset

		this.gt_asset_amount_bob -= byte_to_asset_fees
		const bob_balances = await this.network.wallet.bob.getBalance()
		expect(bob_balances[this.gt_yes_asset].stable).to.be.equal(this.gt_asset_amount_bob)
		expect(bob_balances[this.gt_no_asset].stable).to.be.equal(this.gt_asset_amount_bob)
	}).timeout(60000)

	it('Alice tries to redeem yes without any oracle posting', async () => {
		const { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.gt_yes_asset,
			asset_outputs: [{
				address: this.gt_aa,
				amount: this.gt_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gt_aa
			}]
		}
		)

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
	}).timeout(60000)

	it('Alice tries to redeem no without any oracle posting', async () => {
		const { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.gt_no_asset,
			asset_outputs: [{
				address: this.gt_aa,
				amount: this.gt_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gt_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')
	}).timeout(60000)

	it('Alice tries to redeem no with oracle having posted only value below threshold', async () => {
		var datafeed = {}
		datafeed[this.gt_feed_name] = this.gt_value.toString()

		var objMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		}
		var opts = {
			paying_addresses: [await this.network.wallet.oracle.getAddress()],
			change_address: await this.network.wallet.oracle.getAddress(),
			messages: [objMessage]
		}

		var { unit, error } = await this.network.wallet.oracle.sendMulti(opts)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)

		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.gt_no_asset,
			asset_outputs: [{
				address: this.gt_aa,
				amount: this.gt_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gt_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')
	}).timeout(60000)

	it('Alice redeems with yes', async () => {
		var datafeed = {}
		datafeed[this.gt_feed_name] = (this.gt_value + 0.1).toString()

		var objMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		}
		var opts = {
			paying_addresses: [await this.network.wallet.oracle.getAddress()],
			change_address: await this.network.wallet.oracle.getAddress(),
			messages: [objMessage]
		}

		var { unit, error } = await this.network.wallet.oracle.sendMulti(opts)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)

		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.gt_yes_asset,
			asset_outputs: [{
				address: this.gt_aa,
				amount: this.gt_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gt_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.false
		var { unitObj } = await this.network.wallet.alice.getUnitInfo({ unit: response.response_unit })
		expect(Utils.hasOnlyTheseExternalPayments(unitObj, [{
			address: await this.network.wallet.alice.getAddress(),
			amount: this.gt_asset_amount_alice
		}])).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.gt_aa)
		expect(vars.winner).to.be.equal('yes')
	}).timeout(60000)

	it('bob tries to redeem with no after expiry', async () => {
		var { error } = await this.network.timetravel({ shift: (this.gt_days_for_expiration + 1) + 'd' })
		expect(error).to.be.null

		var { unit, error } = await this.network.wallet.bob.sendMulti({
			asset: this.gt_no_asset,
			asset_outputs: [{
				address: this.gt_aa,
				amount: this.gt_asset_amount_bob
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gt_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')
	}).timeout(60000)

	it('Alice tries to redeem with random after expiry', async () => {
		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.network.asset.random_asset,
			asset_outputs: [{
				address: this.gt_aa,
				amount: 20000
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gt_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
		expect(response.response.error).to.be.equal('foreign asset')
	}).timeout(60000)

	it('bob tries to change winner for no after expiry', async () => {
		const { unit, error } = await this.network.wallet.bob.triggerAaWithData({
			toAddress: this.gt_aa,
			amount: 10000,
			data: {
				winner: 'no'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')

		const { vars } = await this.network.deployer.readAAStateVars(this.gt_aa)
		expect(vars.winner).to.be.equal('yes')
	}).timeout(60000)

	it('Bob redeems with yes', async () => {
		var { unit, error } = await this.network.wallet.bob.sendMulti({
			asset: this.gt_yes_asset,
			asset_outputs: [{
				address: this.gt_aa,
				amount: this.gt_asset_amount_bob
			}],
			base_outputs: [{
				amount: 10000,
				address: this.gt_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.false
		var { unitObj } = await this.network.wallet.bob.getUnitInfo({ unit: response.response_unit })
		expect(Utils.hasOnlyTheseExternalPayments(unitObj, [{
			address: await this.network.wallet.bob.getAddress(),
			amount: this.gt_asset_amount_bob
		}])).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.gt_aa)
		expect(vars.winner).to.be.equal('yes')
	}).timeout(60000)

	it('Deploy AA with greater than comparaison', async () => {
		this.gt_feed_name = 'EUR_USD'
		this.gt_value = 1.2
		this.gt_operator = '>'
		this.gt_days_for_expiration = 10
		const time_now = new Date()
		this.gt_expiry_date = new Date(time_now.getTime() + this.gt_days_for_expiration * 24 * 3600 * 1000).toISOString().slice(0, -14)

		const { address, unit, error } = await this.network.deployer.deployAgent(`[
			"autonomous agent",
			{
					"base_aa": "${this.network.agent.contract_base}",
					"params": {
							"oracle_address": "${await this.network.wallet.oracle.getAddress()}",
							"feed_name":"${this.gt_feed_name}",
							"comparison":"${this.gt_operator}",
							"feed_value":"${this.gt_value}",
							"expiry_date": "${this.gt_expiry_date}"
					}
			}
		]`)
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		await this.network.witnessUntilStable(unit)

		this.gt_aa = address
	}).timeout(10000)

	it('Deploy AA with equal comparaison', async () => {
		this.equal_feed_name = 'US-PRESIDENTIAL-2024'
		this.equal_value = 'DUMBO'
		this.equal_operator = '='
		this.equal_days_for_expiration = 80
		const time_now = new Date()
		this.equal_expiry_date = new Date(time_now.getTime() + this.gt_days_for_expiration * 24 * 3600 * 1000).toISOString().slice(0, -14)

		const { address, unit, error } = await this.network.deployer.deployAgent(`[
			"autonomous agent",
			{
					"base_aa": "${this.network.agent.contract_base}",
					"params": {
							"oracle_address": "${await this.network.wallet.oracle.getAddress()}",
							"feed_name":"${this.equal_feed_name}",
							"comparison":"${this.equal_operator}",
							"feed_value":"${this.equal_value}",
							"expiry_date": "${this.equal_expiry_date}"
					}
			}
		]`)
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		await this.network.witnessUntilStable(unit)

		this.equal_aa = address
	}).timeout(10000)

	it('Alice converts bytes to equal asset', async () => {
		this.equal_asset_amount_alice = 9999999
		const { unit, error } = await this.network.wallet.alice.sendBytes({
			toAddress: this.equal_aa,
			amount: this.equal_asset_amount_alice
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined

		await this.network.witnessUntilStable(response.response_unit)
		const { vars } = await this.network.deployer.readAAStateVars(this.equal_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit

		this.equal_yes_asset = vars.yes_asset
		this.equal_no_asset = vars.no_asset

		this.equal_asset_amount_alice -= byte_to_asset_fees
		var alice_balances = await this.network.wallet.alice.getBalance()
		expect(alice_balances[this.equal_yes_asset].stable).to.be.equal(this.equal_asset_amount_alice)
		expect(alice_balances[this.equal_no_asset].stable).to.be.equal(this.equal_asset_amount_alice)
	}).timeout(60000)

	it('Alice tries to flag equal-aa yes before oracle posts', async () => {
		const { unit, error } = await this.network.wallet.bob.triggerAaWithData({
			toAddress: this.equal_aa,
			amount: 10000,
			data: {
				winner: 'yes'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')

		const { vars } = await this.network.deployer.readAAStateVars(this.equal_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit
		expect(vars.winner).to.be.to.be.undefined
	}).timeout(60000)


	it('Alice tries to flag wrong outcome', async () => {
		const { unit, error } = await this.network.wallet.alice.triggerAaWithData({
			toAddress: this.equal_aa,
			amount: 10000,
			data: {
				winner: 'has won'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.equal('wrong suggested outcome')
		expect(response.bounced).to.be.true

	}).timeout(60000)


	it('Alice flags equal-aa yes after oracle posts', async () => {
		const datafeed = {}
		datafeed[this.equal_feed_name] = this.equal_value

		const objMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		}
		const opts = {
			paying_addresses: [await this.network.wallet.oracle.getAddress()],
			change_address: await this.network.wallet.oracle.getAddress(),
			messages: [objMessage]
		}

		var { unit, error } = await this.network.wallet.oracle.sendMulti(opts)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)

		var { unit, error } = await this.network.wallet.alice.triggerAaWithData({
			toAddress: this.equal_aa,
			amount: 10000,
			data: {
				winner: 'yes'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false

		const { vars } = await this.network.deployer.readAAStateVars(this.equal_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit
		expect(vars.winner).to.be.to.be.equal('yes')
	}).timeout(60000)

	it('Alice tries to redeem equal-aa with no asset', async () => {
		var { error } = await this.network.timetravel({ shift: (this.equal_days_for_expiration + 1) + 'd' })

		expect(error).to.be.null
		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.equal_no_asset,
			asset_outputs: [{
				address: this.equal_aa,
				amount: this.equal_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.equal_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.true
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')
	}).timeout(60000)

	it('Alice tries to flag equal-aa with no after oracle contradicted', async () => {
		const datafeed = {}
		datafeed[this.equal_feed_name] = 'random value'

		const objMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		}
		const opts = {
			paying_addresses: [await this.network.wallet.oracle.getAddress()],
			change_address: await this.network.wallet.oracle.getAddress(),
			messages: [objMessage]
		}

		var { unit, error } = await this.network.wallet.oracle.sendMulti(opts)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)

		var { unit, error } = await this.network.wallet.alice.triggerAaWithData({
			toAddress: this.equal_aa,
			amount: 10000,
			data: {
				winner: 'no'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')
		expect(response.bounced).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.equal_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit
		expect(vars.winner).to.be.to.be.equal('yes')
	}).timeout(60000)

	it('Alice redeems with yes', async () => {
		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.equal_yes_asset,
			asset_outputs: [{
				address: this.equal_aa,
				amount: this.equal_asset_amount_alice
			}],
			base_outputs: [{
				amount: 10000,
				address: this.equal_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.bounced).to.be.false
		var { unitObj } = await this.network.wallet.alice.getUnitInfo({ unit: response.response_unit })
		expect(Utils.hasOnlyTheseExternalPayments(unitObj, [{
			address: await this.network.wallet.alice.getAddress(),
			amount: this.equal_asset_amount_alice
		}])).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.gt_aa)
		expect(vars.winner).to.be.equal('yes')
	}).timeout(60000)

	it('Deploy AA with not-equal comparaison', async () => {
		this.ne_feed_name = 'foo'
		this.ne_value = 'bar'
		this.ne_operator = '!='
		this.ne_days_for_expiration = 10
		const time_now = new Date()
		this.ne_expiry_date = new Date(time_now.getTime() + this.ne_days_for_expiration * 24 * 3600 * 1000).toISOString().slice(0, -14)

		const { address, unit, error } = await this.network.deployer.deployAgent(`[
			"autonomous agent",
			{
				"base_aa": "${this.network.agent.contract_base}",
				"params": {
						"oracle_address": "${await this.network.wallet.oracle.getAddress()}",
						"feed_name":"${this.ne_feed_name}",
						"comparison":"${this.ne_operator}",
						"feed_value":"${this.ne_value}",
						"expiry_date": "${this.ne_expiry_date}"
				}
			}
		]`)
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		await this.network.witnessUntilStable(unit)

		this.ne_aa = address
	}).timeout(10000)

	it('Alice converts bytes to not-equal asset', async () => {
		this.ne_asset_amount_alice = 1963330
		const { unit, error } = await this.network.wallet.alice.sendBytes({
			toAddress: this.ne_aa,
			amount: this.ne_asset_amount_alice
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined

		await this.network.witnessUntilStable(response.response_unit)
		const { vars } = await this.network.deployer.readAAStateVars(this.ne_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit

		this.ne_yes_asset = vars.yes_asset
		this.ne_no_asset = vars.no_asset

		this.ne_asset_amount_alice -= byte_to_asset_fees
		var alice_balances = await this.network.wallet.alice.getBalance()
		expect(alice_balances[this.ne_yes_asset].stable).to.be.equal(this.ne_asset_amount_alice)
		expect(alice_balances[this.ne_no_asset].stable).to.be.equal(this.ne_asset_amount_alice)
	}).timeout(60000)

	it('Alice flags not-equal-aa yes without any AA posting ', async () => {
		var { unit, error } = await this.network.wallet.alice.triggerAaWithData({
			toAddress: this.ne_aa,
			amount: 10000,
			data: {
				winner: 'yes'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')
		expect(response.bounced).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.ne_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit
		expect(vars.winner).to.be.to.be.undefined
	}).timeout(60000)

	it('Alice tries flags not-equal-aa yes after oracle posts ', async () => {
		const datafeed = {}
		datafeed[this.ne_feed_name] = this.ne_value

		const objMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		}
		const opts = {
			paying_addresses: [await this.network.wallet.oracle.getAddress()],
			change_address: await this.network.wallet.oracle.getAddress(),
			messages: [objMessage]
		}

		var { unit, error } = await this.network.wallet.oracle.sendMulti(opts)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)

		var { unit, error } = await this.network.wallet.alice.triggerAaWithData({
			toAddress: this.ne_aa,
			amount: 10000,
			data: {
				winner: 'yes'
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.equal('suggested outcome not confirmed')
		expect(response.bounced).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.ne_aa)

		expect(vars.no_asset).to.be.to.be.validUnit
		expect(vars.yes_asset).to.be.to.be.validUnit
		expect(vars.winner).to.be.to.be.undefined
	}).timeout(60000)

	it('Alice redeems half not-equal-aa with yes', async () => {
		var datafeed = {}
		datafeed[this.ne_feed_name] = 'hey'

		var objMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		}
		var opts = {
			paying_addresses: [await this.network.wallet.oracle.getAddress()],
			change_address: await this.network.wallet.oracle.getAddress(),
			messages: [objMessage]
		}

		var { unit, error } = await this.network.wallet.oracle.sendMulti(opts)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)

		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.ne_yes_asset,
			asset_outputs: [{
				address: this.ne_aa,
				amount: this.ne_asset_amount_alice / 2
			}],
			base_outputs: [{
				amount: 10000,
				address: this.ne_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		var { unitObj } = await this.network.wallet.alice.getUnitInfo({ unit: response.response_unit })
		expect(Utils.hasOnlyTheseExternalPayments(unitObj, [{
			address: await this.network.wallet.alice.getAddress(),
			amount: this.ne_asset_amount_alice / 2
		}])).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.ne_aa)
		expect(vars.winner).to.be.equal('yes')
	}).timeout(60000)

	it('Alice redeems half not-equal-aa with yes', async () => {
		var datafeed = {}
		datafeed[this.ne_feed_name] = 'hey'

		var objMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		}
		var opts = {
			paying_addresses: [await this.network.wallet.oracle.getAddress()],
			change_address: await this.network.wallet.oracle.getAddress(),
			messages: [objMessage]
		}

		var { unit, error } = await this.network.wallet.oracle.sendMulti(opts)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)

		var { unit, error } = await this.network.wallet.alice.sendMulti({
			asset: this.ne_yes_asset,
			asset_outputs: [{
				address: this.ne_aa,
				amount: this.ne_asset_amount_alice / 2
			}],
			base_outputs: [{
				amount: 10000,
				address: this.ne_aa
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		var { unitObj } = await this.network.wallet.alice.getUnitInfo({ unit: response.response_unit })
		expect(Utils.hasOnlyTheseExternalPayments(unitObj, [{
			address: await this.network.wallet.alice.getAddress(),
			amount: this.ne_asset_amount_alice / 2
		}])).to.be.true

		const { vars } = await this.network.deployer.readAAStateVars(this.ne_aa)
		expect(vars.winner).to.be.equal('yes')
	}).timeout(60000)

	after(async () => {
		// uncomment this line to pause test execution to get time for Obyte DAG explorer inspection
		//await Utils.sleep(3600 * 1000)
		await this.network.stop()
	})
})
